/**
 * A single task card.
 *
 * The wording per status is deliberate: "plugin queue", "backend waiting" and
 * "running" are three different things and the card never conflates them.
 */

import {
  STATUS,
  formatDuration,
  formatTime,
  liveExecutionSeconds,
  liveQueueWaitSeconds,
} from '../core/task_model.js';
import { renderOutputPreview } from './output_preview.js';

const STATUS_LABEL = {
  [STATUS.PLUGIN_QUEUED]: '插件排队',
  [STATUS.BACKEND_PENDING]: '后端待执行',
  [STATUS.RUNNING]: '运行中',
  [STATUS.COMPLETED]: '已完成',
  [STATUS.FAILED]: '失败',
  [STATUS.CANCELLED]: '已中止',
  [STATUS.SUBMIT_FAILED]: '提交失败',
};

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
      return '执行失败 · 耗时 ' + formatDuration(record.executionSeconds);
    case STATUS.CANCELLED:
      return '已中止 · 耗时 ' + formatDuration(record.executionSeconds);
    case STATUS.SUBMIT_FAILED:
      return '提交失败';
    default:
      return '';
  }
}

function errorText(record) {
  const error = record.error;
  if (!error) return '';
  if (typeof error === 'string') return error;
  const parts = [];
  if (error.exception_message) parts.push(error.exception_message);
  if (error.exception_type) parts.push('(' + error.exception_type + ')');
  if (error.node_type) parts.push('节点 ' + error.node_type);
  if (!parts.length) return '未知错误';
  return parts.join(' ');
}

export function renderTaskCard(record, ctx) {
  const context = ctx || {};
  const onAction = context.onAction || (() => {});
  const estimate = context.estimate || null;
  const now = context.now || Date.now();

  const card = document.createElement('div');
  card.className = 'rh-tq-card rh-tq-card--' + record.status;
  card.dataset.rhTqId = record.id;

  const head = document.createElement('div');
  head.className = 'rh-tq-card__head';

  const badge = document.createElement('span');
  badge.className = 'rh-tq-badge';
  badge.textContent = STATUS_LABEL[record.status] || record.status;
  head.appendChild(badge);

  const title = document.createElement('span');
  title.className = 'rh-tq-title';
  title.textContent = record.workflowName || '未命名工作流';
  title.title = record.workflowName || record.id;
  head.appendChild(title);
  card.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'rh-tq-meta';
  meta.textContent = '创建 ' + formatTime(record.createdAt) + ' · ' + String(record.id).slice(0, 8);
  card.appendChild(meta);

  const timing = document.createElement('div');
  timing.className = 'rh-tq-timing';
  timing.dataset.rhTqTiming = '1';
  timing.textContent = timingText(record, now);
  card.appendChild(timing);

  if (estimate && estimate.found) {
    const ref = document.createElement('div');
    ref.className = 'rh-tq-ref';
    const last = formatDuration(estimate.last_duration);
    const avg = formatDuration(estimate.avg_duration);
    ref.textContent =
      '上次耗时 ' + last + ' · 平均 ' + avg + '（' + estimate.sample_count + ' 次）';
    card.appendChild(ref);
  }

  const outputsCount = record.outputsCount || 0;
  if (outputsCount) {
    const out = document.createElement('div');
    out.className = 'rh-tq-out';
    out.textContent = '输出 ' + outputsCount + ' 项';
    card.appendChild(out);
  }

  const message = errorText(record);
  if (message) {
    const error = document.createElement('div');
    error.className = 'rh-tq-error';
    error.textContent = message;
    card.appendChild(error);
  }

  const preview = renderOutputPreview(record);
  if (preview) card.appendChild(preview);

  const actions = document.createElement('div');
  actions.className = 'rh-tq-actions';

  const canCancel =
    record.status === STATUS.RUNNING || record.status === STATUS.BACKEND_PENDING;
  if (canCancel) {
    const cancel = document.createElement('button');
    cancel.className = 'rh-tq-btn rh-tq-btn--danger';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => onAction('cancel', record));
    actions.appendChild(cancel);
  }

  if (record.status === STATUS.PLUGIN_QUEUED) {
    const remove = document.createElement('button');
    remove.className = 'rh-tq-btn';
    remove.textContent = '移除';
    remove.addEventListener('click', () => onAction('remove', record));
    actions.appendChild(remove);
  }

  if (record.status === STATUS.FAILED && record.error && record.error.traceback) {
    const trace = document.createElement('button');
    trace.className = 'rh-tq-btn';
    trace.textContent = '查看堆栈';
    trace.addEventListener('click', () => {
      const box = card.querySelector('.rh-tq-error');
      if (box) box.textContent = record.error.traceback;
    });
    actions.appendChild(trace);
  }

  if (actions.childElementCount) card.appendChild(actions);

  return card;
}
