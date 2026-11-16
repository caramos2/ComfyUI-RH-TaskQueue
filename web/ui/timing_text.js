/**
 * The timing line of a task card.
 *
 * It lives apart from the renderer so the wording can be tested without a
 * browser: this module only knows the task model, never the DOM.
 */

import {
  STATUS,
  formatDuration,
  liveExecutionSeconds,
  liveQueueWaitSeconds,
} from '../core/task_model.js';

/** The status dependent timing line. */
export function timingText(record, now = Date.now()) {
  switch (record.status) {
    case STATUS.PLUGIN_QUEUED:
      return '插件排队 ' + formatDuration(liveQueueWaitSeconds(record, now));
    case STATUS.BACKEND_PENDING: {
      const wait = formatDuration(liveQueueWaitSeconds(record, now));
      const position = record.queuePosition ? ' · 队列位置 ' + record.queuePosition : '';
      return '后端等待 ' + wait + position;
    }
    case STATUS.RUNNING:
      return '已运行 ' + formatDuration(liveExecutionSeconds(record, now));
    case STATUS.COMPLETED:
      return '本次耗时 ' + formatDuration(record.executionSeconds);
    case STATUS.FAILED:
      // A task that never started has no duration worth printing.
      return record.executionSeconds === null || record.executionSeconds === undefined
        ? '执行失败'
        : '执行失败 · 耗时 ' + formatDuration(record.executionSeconds);
    case STATUS.CANCELLED:
      return record.executionSeconds === null || record.executionSeconds === undefined
        ? '已中止'
        : '已中止 · 耗时 ' + formatDuration(record.executionSeconds);
    case STATUS.SUBMIT_FAILED:
      return '提交失败';
    default:
      return '';
  }
}
