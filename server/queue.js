import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { executeGenerate, executeSave } from './generate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SETTINGS_PATH = join(__dirname, '..', 'data', 'settings.json');

function readGuard() {
  try {
    const s = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    return {
      intervalMin: s?.guard?.intervalMin ?? 2,
      intervalMax: s?.guard?.intervalMax ?? 5,
      maxPerJob: s?.guard?.maxPerJob ?? 100,
    };
  } catch {
    return { intervalMin: 2, intervalMax: 5, maxPerJob: 100 };
  }
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

export function addTasks(tasks) {
  const { maxPerJob } = readGuard();
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
      const result = await executeGenerate({
        prompt: task.positive,
        negativePrompt: task.negative,
        ...task.params,
        vaultRoot,
      });
      const saved = executeSave(vaultRoot, {
        filename: result.filename,
        seed: result.seed,
        folderSegments: task.folderSegments,
        filenameSegments: task.filenameSegments,
        preset_id: task.preset_id,
      });
      task.status = 'done';
      task.result = { filename: saved.filename, seed: result.seed, width: result.width, height: result.height };
    } catch (e) {
      task.status = 'error';
      task.error = e.message;
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
      const { intervalMin, intervalMax } = readGuard();
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
