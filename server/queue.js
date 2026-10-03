import { randomBytes } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { executeGenerate } from './generate.js';
import { checkGuard, resolveGenParams, InvalidInputError } from './genParams.js';
import { recordInvalid, writeLog } from './log.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = join(__dirname, '..', 'data', 'settings.json');

// S-18・J-9: ガード値が当たらないときは既定値で走らせない（呼び出し側が止める）。理由は集約先に残す
function readGuard(stage) {
  let text = null;
  try {
    if (existsSync(SETTINGS_PATH)) text = readFileSync(SETTINGS_PATH, 'utf8');
  } catch (e) {
    const g = { ok: false, raw: SETTINGS_PATH, reason: `settings.json を読めない: ${e.message}` };
    recordInvalid({ kind: 'queue-guard-invalid', stage, raw: g.raw, reason: g.reason });
    return g;
  }
  const g = checkGuard(text);
  if (!g.ok) recordInvalid({ kind: 'queue-guard-invalid', stage, raw: g.raw, reason: g.reason });
  return g;
}

function generateId() {
  return 't_' + randomBytes(4).toString('hex').slice(0, 5);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

const q = {
  state: 'idle',
  tasks: [],
  currentIndex: null,
  startedAt: null,
  _stopRequested: false,
};

export function getStatus() {
  return { state: q.state, tasks: q.tasks, currentIndex: q.currentIndex, startedAt: q.startedAt };
}

export function getTask(id) {
  return q.tasks.find(t => t.id === id) || null;
}

export function addTasks(tasks) {
  const g = readGuard('S-18 queue.addTasks');
  if (!g.ok) throw new Error(`ガード設定が当たらないためキューに追加しません: ${g.reason}`);
  const { maxPerJob } = g.guard;
  if (q.tasks.length + tasks.length > maxPerJob) {
    throw new Error(`キュー上限（${maxPerJob}件）を超えます（現在${q.tasks.length}件 + 追加${tasks.length}件）`);
  }
  const created = tasks.map(t => ({
    id: generateId(),
    status: 'pending',
    positive: t.positive || '',
    negative: t.negative || '',
    params: t.params || {},
    folderSegments: t.folderSegments || [],
    filenameSegments: t.filenameSegments || [],
    preset_id: t.preset_id || null,
    label: t.label || '（ラベルなし）',
    result: null,
    saved: false,
    error: null,
  }));
  q.tasks.push(...created);
  return created.length;
}

export function removeTask(id) {
  const idx = q.tasks.findIndex(t => t.id === id);
  if (idx === -1) throw new Error('タスクが見つかりません');
  if (q.tasks[idx].status !== 'pending') throw new Error('pendingタスクのみ削除できます');
  q.tasks.splice(idx, 1);
}

export function clearQueue() {
  if (q.state === 'running') throw new Error('実行中はクリアできません');
  q.tasks = [];
  q.currentIndex = null;
  q.startedAt = null;
}

export function startQueue(vaultRoot) {
  if (q.state === 'running') throw new Error('既に実行中です');
  const firstPending = q.tasks.findIndex(t => t.status === 'pending');
  if (firstPending === -1) throw new Error('実行できるタスクがありません');
  const g = readGuard('S-18 queue.startQueue');
  if (!g.ok) throw new Error(`ガード設定が当たらないためキューを開始しません: ${g.reason}`);
  q.state = 'running';
  q._stopRequested = false;
  q.currentIndex = firstPending;
  if (!q.startedAt) q.startedAt = new Date().toISOString();
  setImmediate(() => runLoop(vaultRoot));
}

export function stopQueue() {
  if (q.state !== 'running') throw new Error('実行中ではありません');
  q._stopRequested = true;
}

async function runLoop(vaultRoot) {
  while (q.currentIndex < q.tasks.length) {
    const task = q.tasks[q.currentIndex];

    if (task.status !== 'pending') {
      q.currentIndex++;
      continue;
    }

    task.status = 'running';

    try {
      // S-04・J-9: 追加時に検査済み。走らせる直前にも確かめ、既定値は未指定の欄だけに使う
      const { problems, params } = resolveGenParams(task.params, `tasks[${task.id}].params`);
      if (problems.length) throw new InvalidInputError('S-04 queue.runLoop', problems, task.params);
      const result = await executeGenerate({
        prompt: task.positive,
        negativePrompt: task.negative,
        ...params,
        vaultRoot,
        origin: 'queue',
      });
      task.status = 'done';
      task.result = { filename: result.filename, seed: result.seed, width: result.width, height: result.height };
    } catch (e) {
      task.status = 'error';
      task.error = e.message;
      // J-10: キューの失敗も集約先に残す（NovelAI の応答は novelai.js で種別付きで記録済み）
      if (e.invalid) recordInvalid({ kind: 'generate-params-invalid', stage: e.stage, raw: { task_id: task.id, problems: e.problems }, reason: e.message });
      else if (!e.novelaiRecorded) writeLog('error', 'GENERATE_FAILED', e.message, { origin: 'queue', task_id: task.id });
      for (let i = q.currentIndex + 1; i < q.tasks.length; i++) {
        if (q.tasks[i].status === 'pending') q.tasks[i].status = 'skipped';
      }
      q.state = 'paused';
      return;
    }

    q.currentIndex++;

    if (q._stopRequested) {
      q.state = 'paused';
      q._stopRequested = false;
      return;
    }

    const hasPending = q.tasks.slice(q.currentIndex).some(t => t.status === 'pending');
    if (hasPending) {
      const g = readGuard('S-18 queue.runLoop');
      if (!g.ok) {
        // 走行中にガード値が当たらなくなった: 既定値で続けず中断する
        q.state = 'paused';
        q._stopRequested = false;
        return;
      }
      const { intervalMin, intervalMax } = g.guard;
      const wait = (intervalMin + Math.random() * (intervalMax - intervalMin)) * 1000;
      console.log(`[Queue] 次のタスクまで ${(wait / 1000).toFixed(1)}s 待機`);
      await sleep(wait);

      if (q._stopRequested) {
        q.state = 'paused';
        q._stopRequested = false;
        return;
      }
    }
  }

  q.state = 'idle';
}
