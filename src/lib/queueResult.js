// キュー完了タスクの result を結果一覧の項目にする（§4.3 #6）
// 当たる枝: result がオブジェクト、または JSON としてオブジェクトに解析できる文字列
// 当たらないもの: 集約先に残し、invalid の項目として一覧に出す（黙って捨てない・永久に外さない）
import { recordInvalid } from './invalidLog.js';

function parseSegArr(raw, field, taskId) {
  if (Array.isArray(raw)) return raw;
  if (raw === undefined || raw === null) return [];
  if (typeof raw === 'string') {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v;
      throw new Error('配列でない');
    } catch (e) {
      recordInvalid({ kind: 'queue-task-segments-unparseable', stage: `§4.3 #6 queueResult.${field}`, raw: { task_id: taskId, [field]: raw }, reason: e.message });
      return [];
    }
  }
  recordInvalid({ kind: 'queue-task-segments-unparseable', stage: `§4.3 #6 queueResult.${field}`, raw: { task_id: taskId, [field]: raw }, reason: '配列でも文字列でもない' });
  return [];
}

export function parseTaskResult(task) {
  const base = {
    task_id: task.id,
    folderSegments: parseSegArr(task.folder_segments ?? task.folderSegments, 'folderSegments', task.id),
    filenameSegments: parseSegArr(task.filename_segments ?? task.filenameSegments, 'filenameSegments', task.id),
    saved: !!task.saved,
  };
  let parsed = task.result;
  let reason = null;
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed); } catch (e) { reason = `JSON として解析できない: ${e.message}`; }
  }
  if (!reason && (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))) reason = '結果が空かオブジェクトでない';
  if (reason) {
    recordInvalid({ kind: 'queue-task-result-unparseable', stage: '§4.3 #6 queueResult.parseTaskResult', raw: { task_id: task.id, result: task.result }, reason });
    return { ...base, invalid: true, invalidReason: reason };
  }
  return { ...parsed, ...base };
}
