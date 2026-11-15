/**
 * Compatibility adapter for ComfyUI versions without /api/jobs.
 *
 * It reads the classic /queue and /history endpoints and produces exactly the
 * same TaskRecord shape as the Jobs API adapter, so nothing downstream has to
 * know which backend it is talking to.
 */

import { fromJobsApi, STATUS } from '../core/task_model.js';

function extraDataOf(tuple) {
  if (!Array.isArray(tuple)) return {};
  return tuple[3] || {};
}

function createTimeOf(extraData) {
  const value = extraData && extraData.create_time;
  return typeof value === 'number' ? value : null;
}

/** Reconstruct execution timings from the history status messages. */
function timingsFromStatus(statusInfo) {
  const result = {
    executionStartTime: null,
    executionEndTime: null,
    error: null,
    interrupted: false,
  };
  if (!statusInfo) return result;
  const messages = statusInfo.messages || [];
  for (const entry of messages) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [name, data] = entry;
    if (!data || typeof data !== 'object') continue;
    if (name === 'execution_start') {
      result.executionStartTime = typeof data.timestamp === 'number' ? data.timestamp : null;
    } else if (
      name === 'execution_success' ||
      name === 'execution_error' ||
      name === 'execution_interrupted'
    ) {
      result.executionEndTime = typeof data.timestamp === 'number' ? data.timestamp : null;
      if (name === 'execution_error') result.error = data;
      if (name === 'execution_interrupted') result.interrupted = true;
    }
  }
  return result;
}

function historyItemToRecord(promptId, item) {
  const statusInfo = item.status || {};
  const timings = timingsFromStatus(statusInfo);
  const statusStr = statusInfo.status_str;
  let status = STATUS.COMPLETED;
  if (statusStr === 'error') {
    status = timings.interrupted ? STATUS.CANCELLED : STATUS.FAILED;
  }

  const outputs = item.outputs || {};
  let outputsCount = 0;
  for (const nodeOutputs of Object.values(outputs)) {
    if (!nodeOutputs || typeof nodeOutputs !== 'object') continue;
    for (const [mediaType, items] of Object.entries(nodeOutputs)) {
      if (mediaType === 'animated' || !Array.isArray(items)) continue;
      outputsCount += items.length;
    }
  }

  const extraData = (item.prompt && item.prompt[3]) || {};
  const workflowId =
    extraData.extra_pnginfo && extraData.extra_pnginfo.workflow
      ? extraData.extra_pnginfo.workflow.id
      : null;
  return fromJobsApi(
    {
      id: promptId,
      status,
      create_time: createTimeOf(extraData),
      execution_start_time: timings.executionStartTime,
      execution_end_time: timings.executionEndTime,
      execution_error: timings.error,
      outputs_count: outputsCount,
      workflow: { prompt: (item.prompt && item.prompt[2]) || null },
      previewable_outputs_count: 0,
      outputs,
      workflow_id: workflowId,
    },
    { includeOutputs: true },
  );
}

export class LegacyApiAdapter {
  constructor(apiClient) {
    this.apiClient = apiClient;
    this.mode = 'legacy';
  }

  async supported() {
    try {
      await this.apiClient.fetchQueue();
      return true;
    } catch (err) {
      return false;
    }
  }

  async list({ limit = 50 } = {}) {
    const queue = await this.apiClient.fetchQueue();
    const records = [];

    const running = (queue && queue.queue_running) || [];
    for (const item of running) {
      const extraData = extraDataOf(item);
      records.push(
        fromJobsApi(
          {
            id: item[1],
            status: 'in_progress',
            create_time: createTimeOf(extraData),
          },
          { origin: 'backend' },
        ),
      );
    }

    const pending = (queue && queue.queue_pending) || [];
    pending.forEach((item, index) => {
      const extraData = extraDataOf(item);
      const record = fromJobsApi(
        {
          id: item[1],
          status: 'pending',
          create_time: createTimeOf(extraData),
        },
        { origin: 'backend' },
      );
      record.queuePosition = index + 1;
      records.push(record);
    });

    let history = {};
    try {
      history = (await this.apiClient.fetchHistory(limit)) || {};
    } catch (err) {
      history = {};
    }
    for (const [promptId, item] of Object.entries(history)) {
      records.push(historyItemToRecord(promptId, item));
    }
    return records;
  }

  async detail(id) {
    const item = await this.apiClient.fetchHistoryItem(id);
    return historyItemToRecord(id, item);
  }

  async cancel(id) {
    // The legacy API has no per-job cancel; the plugin reports this honestly
    // instead of pretending the job was stopped.
    return false;
  }
}
