/**
 * A single task card.
 *
 * The wording per status is deliberate: "plugin queue", "backend waiting" and
 * "running" are three different things and the card never conflates them.
 */

import { STATUS, formatDuration, formatTime } from '../core/task_model.js';
import { findFirstOutputFile, renderOutputPreview } from './output_preview.js';
import { timingText } from './timing_text.js';
import { i18n as sharedI18n } from '../core/i18n.js';

export { timingText };

const STATUS_LABEL_KEY = {
  [STATUS.PLUGIN_QUEUED]: 'card.status.pluginQueued',
  [STATUS.BACKEND_PENDING]: 'card.status.backendPending',
  [STATUS.RUNNING]: 'card.status.running',
  [STATUS.COMPLETED]: 'card.status.completed',
  [STATUS.FAILED]: 'card.status.failed',
  [STATUS.CANCELLED]: 'card.status.cancelled',
  [STATUS.SUBMIT_FAILED]: 'card.status.submitFailed',
};

function errorText(record, t) {
  const error = record.error;
  if (!error) return '';
  if (typeof error === 'string') return error;
  const parts = [];
  if (error.exception_message) parts.push(error.exception_message);
  if (error.exception_type) parts.push('(' + error.exception_type + ')');
  if (error.node_type) parts.push(t('card.error.node', { type: error.node_type }));
  if (!parts.length) return t('card.error.unknown');
  return parts.join(' ');
}

export function renderTaskCard(record, ctx) {
  const context = ctx || {};
  const onAction = context.onAction || (() => {});
  const estimate = context.estimate || null;
  const now = context.now || Date.now();
  const i18n = context.i18n || sharedI18n;
  const t = (key, params) => i18n.t(key, params);

  const card = document.createElement('div');
  card.className = 'rh-tq-card rh-tq-card--' + record.status;
  card.dataset.rhTqId = record.id;

  const head = document.createElement('div');
  head.className = 'rh-tq-card__head';

  const badge = document.createElement('span');
  badge.className = 'rh-tq-badge';
  const statusKey = STATUS_LABEL_KEY[record.status];
  badge.textContent = statusKey ? t(statusKey) : record.status;
  head.appendChild(badge);

  const title = document.createElement('span');
  title.className = 'rh-tq-title';
  title.textContent = record.workflowName || t('card.untitled');
  title.title = record.workflowName || record.id;
  head.appendChild(title);
  card.appendChild(head);

  const meta = document.createElement('div');
  meta.className = 'rh-tq-meta';
  meta.textContent = t('card.created') + formatTime(record.createdAt) + ' · ' + String(record.id).slice(0, 8);
  card.appendChild(meta);

  const timing = document.createElement('div');
  timing.className = 'rh-tq-timing';
  timing.dataset.rhTqTiming = '1';
  timing.textContent = timingText(record, now, t);
  card.appendChild(timing);

  if (estimate && estimate.found) {
    const ref = document.createElement('div');
    ref.className = 'rh-tq-ref';
    ref.textContent = t('card.reference', {
      last: formatDuration(estimate.last_duration),
      avg: formatDuration(estimate.avg_duration),
      count: estimate.sample_count,
    });
    card.appendChild(ref);
  }

  const outputsCount = record.outputsCount || 0;
  if (outputsCount) {
    const out = document.createElement('div');
    out.className = 'rh-tq-out';
    out.textContent = t('card.outputs', { count: outputsCount });
    card.appendChild(out);
  }

  const message = errorText(record, t);
  if (message) {
    const error = document.createElement('div');
    error.className = 'rh-tq-error';
    error.textContent = message;
    card.appendChild(error);
  }

  const preview = renderOutputPreview(record, i18n);
  if (preview) card.appendChild(preview);

  const actions = document.createElement('div');
  actions.className = 'rh-tq-actions';

  // A queued task can be cancelled too: a plugin queued task is dropped
  // from the plugin queue, a backend pending task is dequeued by ComfyUI.
  const canCancel =
    record.status === STATUS.RUNNING ||
    record.status === STATUS.BACKEND_PENDING ||
    record.status === STATUS.PLUGIN_QUEUED;
  if (canCancel) {
    const cancel = document.createElement('button');
    cancel.className = 'rh-tq-btn rh-tq-btn--danger';
    cancel.textContent = t('card.action.cancel');
    cancel.addEventListener('click', () => onAction('cancel', record));
    actions.appendChild(cancel);
  }

  const revealTarget = findFirstOutputFile(record);
  if (revealTarget) {
    const reveal = document.createElement('button');
    reveal.className = 'rh-tq-btn';
    reveal.textContent = t('card.action.reveal');
    reveal.title = t('card.action.revealTitle');
    reveal.addEventListener('click', () =>
      onAction('reveal', { id: record.id, target: revealTarget }),
    );
    actions.appendChild(reveal);
  }

  if (record.status === STATUS.FAILED && record.error && record.error.traceback) {
    const trace = document.createElement('button');
    trace.className = 'rh-tq-btn';
    trace.textContent = t('card.action.traceback');
    trace.addEventListener('click', () => {
      const box = card.querySelector('.rh-tq-error');
      if (box) box.textContent = record.error.traceback;
    });
    actions.appendChild(trace);
  }

  if (actions.childElementCount) card.appendChild(actions);

  return card;
}
