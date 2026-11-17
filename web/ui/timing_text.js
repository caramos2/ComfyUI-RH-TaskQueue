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
import { i18n as sharedI18n } from '../core/i18n.js';

/**
 * The status dependent timing line.
 *
 * The translator can be handed in, which keeps the module testable in both
 * languages without touching the global instance.
 */
export function timingText(record, now = Date.now(), translate) {
  const t = translate || ((key, params) => sharedI18n.t(key, params));
  switch (record.status) {
    case STATUS.PLUGIN_QUEUED:
      return t('timing.pluginQueued') + formatDuration(liveQueueWaitSeconds(record, now));
    case STATUS.BACKEND_PENDING: {
      const wait = formatDuration(liveQueueWaitSeconds(record, now));
      const position = record.queuePosition
        ? t('timing.queuePosition') + record.queuePosition
        : '';
      return t('timing.backendWaiting') + wait + position;
    }
    case STATUS.RUNNING:
      return t('timing.running') + formatDuration(liveExecutionSeconds(record, now));
    case STATUS.COMPLETED:
      return t('timing.duration') + formatDuration(record.executionSeconds);
    case STATUS.FAILED:
      // A task that never started has no duration worth printing.
      return record.executionSeconds === null || record.executionSeconds === undefined
        ? t('timing.failed')
        : t('timing.failedWithDuration') + formatDuration(record.executionSeconds);
    case STATUS.CANCELLED:
      return record.executionSeconds === null || record.executionSeconds === undefined
        ? t('timing.cancelled')
        : t('timing.cancelledWithDuration') + formatDuration(record.executionSeconds);
    case STATUS.SUBMIT_FAILED:
      return t('timing.submitFailed');
    default:
      return '';
  }
}
