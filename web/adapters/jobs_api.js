/**
 * Adapter for ComfyUI's newer Jobs API (/api/jobs).
 *
 * This is the preferred source: it reports running, pending and finished jobs
 * with normalised fields and already knows how to describe outputs.
 */

import { fromJobsApi, STATUS } from '../core/task_model.js';

export class JobsApiAdapter {
  constructor(apiClient) {
    this.apiClient = apiClient;
    this.mode = 'jobs_api';
  }

  async supported() {
    try {
      await this.apiClient.fetchJobs({ limit: 1 });
      return true;
    } catch (err) {
      return false;
    }
  }

  async list({ limit = 50, offset = 0, status = null } = {}) {
    const data = await this.apiClient.fetchJobs({ limit, offset, status });
    const jobs = data && Array.isArray(data.jobs) ? data.jobs : [];
    const records = jobs.map((job) => fromJobsApi(job));

    // The API does not expose a queue position, but pending jobs arrive
    // ordered by creation time, so the index inside the pending group is the
    // position in the backend queue.
    const pending = records
      .filter((record) => record.status === STATUS.BACKEND_PENDING)
      .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    pending.forEach((record, index) => {
      record.queuePosition = index + 1;
    });
    return records;
  }

  async detail(id) {
    const job = await this.apiClient.fetchJob(id);
    return fromJobsApi(job, { includeOutputs: true });
  }

  async cancel(id) {
    const result = await this.apiClient.cancelJob(id);
    return Boolean(result && result.cancelled);
  }
}
