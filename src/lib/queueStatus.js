// キューのタスク status・キュー state の振り分け（F-08・J-2）
// 当たる枝: いまの Fran（server/queue.js）と Worker（PvQueue）が出す値。state の idle も当たる枝
// 当たらない値: 集約先に残し、画面には元の値をそのまま出す（同じ値は一度だけ記録する）
import { recordInvalid } from './invalidLog.js';

export const TASK_STATUSES = ['pending', 'running', 'done', 'error', 'skipped'];
export const QUEUE_STATES = ['idle', 'running', 'paused'];

const reported = new Set();

function reportOnce(key, entry) {
  if (reported.has(key)) return;
  reported.add(key);
  recordInvalid(entry);
}

export function checkTaskStatus(status, taskId) {
  if (TASK_STATUSES.includes(status)) return true;
  reportOnce(`task|${taskId}|${String(status)}`, {
    kind: 'queue-task-status-unknown', stage: 'F-08 GenerateScreen.QueueTaskRow',
    raw: { task_id: taskId, status }, reason: `status が ${TASK_STATUSES.join('/')} のどれでもない`,
  });
  return false;
}

export function checkQueueState(state) {
  if (QUEUE_STATES.includes(state)) return true;
  reportOnce(`state|${String(state)}`, {
    kind: 'queue-state-unknown', stage: 'F-08 GenerateScreen.queue',
    raw: { state }, reason: `state が ${QUEUE_STATES.join('/')} のどれでもない`,
  });
  return false;
}
