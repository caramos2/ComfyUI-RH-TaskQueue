/**
 * The one task shape used by the whole plugin.
 *
 * Every adapter (Jobs API, legacy queue/history) converts into a TaskRecord,
 * so the UI never has to care which backend version it is talking to.
 *
 * Timing rules (see the design doc):
 *   submittedAt        - when the prompt was handed to ComfyUI
 *   executionStartedAt - when ComfyUI actually began executing it
 * The two are never the same value, and submitting is never treated as
 * starting.
 */

export const STATUS = {
  PLUGIN_QUEUED: 'plugin_queued',
  BACKEND_PENDING: 'backend_pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  SUBMIT_FAILED: 'submit_failed',
};

export const TERMINAL_STATUSES = [STATUS.COMPLETED, STATUS.FAILED, STATUS.CANCELLED];

/** How far a task has progressed. Terminal states share the highest rank. */
const STATUS_RANK = {
  [STATUS.PLUGIN_QUEUED]: 0,
  [STATUS.SUBMIT_FAILED]: 1,
  [STATUS.BACKEND_PENDING]: 2,
  [STATUS.RUNNING]: 3,
  [STATUS.COMPLETED]: 4,
  [STATUS.FAILED]: 4,
  [STATUS.CANCELLED]: 4,
};

const API_STATUS_MAP = {
  pending: STATUS.BACKEND_PENDING,
  in_progress: STATUS.RUNNING,
  completed: STATUS.COMPLETED,
  failed: STATUS.FAILED,
  cancelled: STATUS.CANCELLED,
};

export function isTerminal(status) {
  return TERMINAL_STATUSES.includes(status);
}

function num(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Recompute the derived timing fields from the three raw timestamps. */
export function applyTiming(record) {
  const start = num(record.executionStartedAt);
  const end = num(record.executionEndedAt);
  const submitted = num(record.submittedAt);
  if (start !== null && submitted !== null) {
    record.queueWaitSeconds = Math.max(0, (start - submitted) / 1000);
  } else {
    record.queueWaitSeconds = null;
  }
  if (start !== null && end !== null) {
    record.executionSeconds = Math.max(0, (end - start) / 1000);
  } else {
    record.executionSeconds = null;
  }
  return record;
}

/**
 * Timing fields derived from the raw timestamps, without mutating the input.
 */
export function computeTiming(record) {
  return applyTiming({ ...record });
}

/**
 * Convert a Jobs API entry into a TaskRecord.
 *
 * The backend deliberately does NOT expose execution_start_time for queued or
 * running jobs, so executionStartedAt stays null until either the websocket
 * reports the start or the job reaches a terminal state.
 */
export function fromJobsApi(job, options = {}) {
  const status = API_STATUS_MAP[job.status] || STATUS.BACKEND_PENDING;
  const createdAt = num(job.create_time);
  const record = {
    id: job.id,
    status,
    origin: options.origin || 'backend',
    // The workflow id is a uuid; it belongs in workflowId, not in the name.
    workflowName: options.workflowName || null,
    workflowId: job.workflow_id || null,
    createdAt: options.createdAt !== undefined ? options.createdAt : createdAt,
    submittedAt: options.submittedAt !== undefined ? options.submittedAt : createdAt,
    executionStartedAt: num(job.execution_start_time),
    executionEndedAt: num(job.execution_end_time),
    queueWaitSeconds: null,
    executionSeconds: null,
    outputsCount: num(job.outputs_count) || 0,
    previewableOutputsCount: num(job.previewable_outputs_count) || 0,
    outputs: options.includeOutputs ? job.outputs || null : null,
    workflow: job.workflow || null,
    signatureHint: null,
    previewOutput: job.preview_output || null,
    error: job.execution_error || null,
    signature: options.signature || null,
    notified: false,
    queuePosition: options.queuePosition !== undefined ? options.queuePosition : null,
    needsDetail: Boolean(options.includeOutputs),
  };
  return applyTiming(record);
}

/**
 * Merge a freshly fetched record into the one we already show.
 *
 * Null incoming values never erase known data, and a task never goes back
 * from a terminal state to a non terminal one.
 */
export function mergeRecord(base, incoming) {
  if (!base) return incoming ? { ...incoming } : null;
  if (!incoming) return { ...base };
  const merged = { ...base };

  const fields = [
    'workflowName',
    'workflowId',
    // The workflow payload carries the API prompt, which is what the
    // fingerprint is computed from.
    'workflow',
    'submittedAt',
    'executionStartedAt',
    'executionEndedAt',
    'signature',
    'queuePosition',
    'previewOutput',
    'error',
  ];
  for (const field of fields) {
    if (incoming[field] !== null && incoming[field] !== undefined) {
      merged[field] = incoming[field];
    }
  }
  if (typeof incoming.outputsCount === 'number') merged.outputsCount = incoming.outputsCount;
  if (typeof incoming.previewableOutputsCount === 'number') {
    merged.previewableOutputsCount = incoming.previewableOutputsCount;
  }
  if (incoming.outputs !== null && incoming.outputs !== undefined) {
    merged.outputs = incoming.outputs;
  }
  if (incoming.createdAt !== null && incoming.createdAt !== undefined) {
    merged.createdAt = incoming.createdAt;
  }

  const baseRank = STATUS_RANK[base.status] || 0;
  const incomingRank = STATUS_RANK[incoming.status] || 0;
  if (incomingRank >= baseRank) merged.status = incoming.status;

  merged.notified = Boolean(base.notified || incoming.notified);
  return applyTiming(merged);
}

/** Live elapsed seconds for a running task. */
export function liveExecutionSeconds(record, now = Date.now()) {
  if (!record || record.status !== STATUS.RUNNING) return null;
  const start = num(record.executionStartedAt);
  if (start === null) return null;
  return Math.max(0, (now - start) / 1000);
}

/** Live queue wait for a task that has been submitted but not started. */
export function liveQueueWaitSeconds(record, now = Date.now()) {
  if (!record) return null;
  if (record.status === STATUS.PLUGIN_QUEUED) {
    // Not submitted yet, so the wait is measured from creation.
    const created = num(record.createdAt);
    return created === null ? null : Math.max(0, (now - created) / 1000);
  }
  if (record.status === STATUS.BACKEND_PENDING) {
    const submitted = num(record.submittedAt);
    return submitted === null ? null : Math.max(0, (now - submitted) / 1000);
  }
  return null;
}

/** MM:SS formatting. */
export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--';
  const total = Math.floor(Math.max(0, seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return String(minutes).padStart(2, '0') + ':' + String(rest).padStart(2, '0');
}

/** Human readable clock time. */
export function formatTime(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '--';
  const date = new Date(ms);
  const pad = (value) => String(value).padStart(2, '0');
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds());
}
