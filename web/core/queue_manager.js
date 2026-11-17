/**
 * The plugin's own submission queue.
 *
 * ComfyUI executes one prompt at a time. The "pre-submit limit" therefore
 * does NOT create parallel GPU work: it controls how many tasks the plugin
 * hands to ComfyUI ahead of time. Anything above the limit waits in the
 * plugin's own list and is released when a slot frees up.
 *
 * Only plugin-originated tasks are counted against the limit; tasks queued
 * through the native Queue Prompt button are none of our business.
 */

import { STATUS } from './task_model.js';
import { computeSignature } from './fingerprint.js';

const LEADER_KEY = 'rh_taskqueue_leader';
const LEADER_TTL = 8000;
const LEADER_HEARTBEAT = 2500;
const CHANNEL_NAME = 'rh-taskqueue';

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return 'local-' + crypto.randomUUID();
  return 'local-' + Date.now() + '-' + Math.floor(Math.random() * 1e9);
}

function nowMs() {
  return Date.now();
}

export class QueueManager {
  constructor({ apiClient, taskStore, settings, onChange }) {
    this.apiClient = apiClient;
    this.taskStore = taskStore;
    this.settings = settings;
    this.onChange = onChange || (() => {});
    this.records = new Map();
    this.tabId = makeId();
    this.timer = null;
    this.channel = null;
    // Whether this tab can still reach the backend. A tab that lost the
    // server must not keep the leader lease, or the other tabs starve.
    this.connected = true;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.channel = new BroadcastChannel(CHANNEL_NAME);
        this.channel.onmessage = (event) => {
          const data = event.data;
          if (!data) return;
          if (data.type === 'state-changed') {
            this.onChange();
            return;
          }
          if (data.type === 'task-submitted') {
            // Another tab took this task out of the shared queue. Drop our
            // copy so the card does not stay stuck on "plugin queued".
            if (data.id) this.records.delete(data.id);
            this.onChange();
          }
        };
      }
    } catch (err) {
      this.channel = null;
    }
  }

  // -- leader lease ------------------------------------------------------

  isLeader() {
    try {
      const raw = window.localStorage.getItem(LEADER_KEY);
      if (!raw) return this._claimLeadership();
      const lease = JSON.parse(raw);
      if (!lease || lease.id === this.tabId) return this._claimLeadership();
      if (nowMs() - (lease.ts || 0) > LEADER_TTL) return this._claimLeadership();
      return false;
    } catch (err) {
      return true;
    }
  }

  _claimLeadership() {
    try {
      window.localStorage.setItem(
        LEADER_KEY,
        JSON.stringify({ id: this.tabId, ts: nowMs() }),
      );
      return true;
    } catch (err) {
      return true;
    }
  }

  _heartbeat() {
    // A tab that cannot reach the backend must give the lease back: the
    // queue would otherwise stall in the other tabs forever.
    if (!this.connected) {
      this._releaseLease();
      return;
    }
    try {
      const raw = window.localStorage.getItem(LEADER_KEY);
      const lease = raw ? JSON.parse(raw) : null;
      if (!lease || lease.id === this.tabId) {
        this._claimLeadership();
      }
    } catch (err) {
      /* ignore */
    }
  }

  /** Give the leader lease back so another tab can take over. */
  _releaseLease() {
    try {
      const raw = window.localStorage.getItem(LEADER_KEY);
      const lease = raw ? JSON.parse(raw) : null;
      if (lease && lease.id === this.tabId) {
        window.localStorage.removeItem(LEADER_KEY);
      }
    } catch (err) {
      /* ignore */
    }
  }

  /**
   * Tell the queue whether this tab still has a working backend connection.
   *
   * The lease is only worth holding while the tab can actually dispatch.
   */
  setConnected(connected) {
    this.connected = connected !== false;
    if (!this.connected) this._releaseLease();
    return this.connected;
  }

  broadcast(message) {
    if (!this.channel) return;
    try {
      this.channel.postMessage(message || { type: 'state-changed' });
    } catch (err) {
      /* ignore */
    }
  }

  // -- lifecycle ---------------------------------------------------------

  async start() {
    await this.taskStore.open();
    const stored = await this.taskStore.listLocal();
    for (const record of stored) {
      if (record && record.id) this.records.set(record.id, record);
    }
    // Hand the lease over immediately when this tab goes away. Without
    // this a reloaded page would have to wait for the lease to time out.
    this._releaseOnUnload = () => this._releaseLease();
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', this._releaseOnUnload);
      window.addEventListener('beforeunload', this._releaseOnUnload);
    }
    this.timer = setInterval(() => {
      this._heartbeat();
      this.dispatch();
    }, LEADER_HEARTBEAT);
    this.dispatch();
    this.onChange();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // -- queue operations --------------------------------------------------

  getLocalTasks() {
    return Array.from(this.records.values()).filter(
      (record) => record.status === STATUS.PLUGIN_QUEUED,
    );
  }

  getAll() {
    return Array.from(this.records.values());
  }

  inFlightCount() {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.origin !== 'plugin') continue;
      if (
        record.status === STATUS.BACKEND_PENDING ||
        record.status === STATUS.RUNNING
      ) {
        count += 1;
      }
    }
    return count;
  }

  async enqueue(snapshot) {
    const prompt = snapshot && snapshot.prompt;
    if (!prompt) throw new Error('enqueue needs a workflow snapshot');
    let signature = null;
    let signatureVersion = null;
    try {
      const computed = computeSignature(prompt);
      signature = computed.signature;
      signatureVersion = computed.signature_version;
    } catch (err) {
      /* the queue works fine without a signature */
    }
    const record = {
      id: makeId(),
      status: STATUS.PLUGIN_QUEUED,
      origin: 'plugin',
      workflowName: (snapshot && snapshot.name) || null,
      workflowId: (snapshot && snapshot.workflow && snapshot.workflow.id) || null,
      createdAt: nowMs(),
      submittedAt: null,
      executionStartedAt: null,
      executionEndedAt: null,
      queueWaitSeconds: null,
      executionSeconds: null,
      outputsCount: 0,
      previewableOutputsCount: 0,
      outputs: null,
      error: null,
      signature,
      signature_version: signatureVersion,
      notified: false,
      queuePosition: null,
      snapshot: {
        prompt,
        workflow: (snapshot && snapshot.workflow) || null,
        extraData: (snapshot && snapshot.extraData) || null,
      },
    };
    this.records.set(record.id, record);
    await this.taskStore.putLocal(record);
    this.onChange();
    this.dispatch();
    return record;
  }

  async remove(id) {
    const record = this.records.get(id);
    if (!record) return false;
    if (record.status !== STATUS.PLUGIN_QUEUED) return false;
    this.records.delete(id);
    await this.taskStore.deleteLocal(id);
    this.onChange();
    return true;
  }

  async clearQueued() {
    const queued = this.getLocalTasks();
    for (const record of queued) {
      this.records.delete(record.id);
      await this.taskStore.deleteLocal(record.id);
    }
    this.onChange();
    return queued.length;
  }

  nextQueued() {
    const queued = this.getLocalTasks().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return queued.length ? queued[0] : null;
  }

  /**
   * Pick up tasks that another tab queued.
   *
   * The queue itself lives in the shared store, but every tab keeps its own
   * copy in memory. The tab that holds the leader lease is the one that
   * dispatches, so it has to read the shared queue first - otherwise a task
   * queued in another tab would never be submitted.
   */
  async mergeFromStore() {
    try {
      const stored = await this.taskStore.listLocal();
      for (const record of stored) {
        if (!record || !record.id) continue;
        if (this.records.has(record.id)) continue;
        this.records.set(record.id, record);
      }
    } catch (err) {
      /* the store is optional */
    }
  }

  async dispatch() {
    if (this.settings.get('paused')) return;
    if (!this.isLeader()) return;
    await this.mergeFromStore();
    const limit = Math.max(1, Number(this.settings.get('preSubmitLimit')) || 1);
    let guard = 0;
    while (this.inFlightCount() < limit && guard < 16) {
      guard += 1;
      const next = this.nextQueued();
      if (!next) break;
      await this.submit(next);
    }
  }

  async submit(record) {
    const snapshot = record.snapshot || {};
    try {
      const { promptId } = await this.apiClient.submitPrompt({
        prompt: snapshot.prompt,
        workflow: snapshot.workflow,
      });
      if (!promptId) throw new Error('ComfyUI did not return a prompt_id');
      const submittedAt = nowMs();
      const next = Object.assign({}, record, {
        id: promptId,
        localId: record.id,
        status: STATUS.BACKEND_PENDING,
        submittedAt,
        executionStartedAt: null,
        executionEndedAt: null,
        snapshot: undefined,
      });
      this.records.delete(record.id);
      this.records.set(promptId, next);
      await this.taskStore.deleteLocal(record.id);
      this.broadcast({ type: 'task-submitted', id: record.id, promptId });
      this.onChange();
      return next;
    } catch (err) {
      record.status = STATUS.SUBMIT_FAILED;
      record.error = { exception_message: err.message };
      // Keep the record so the user can see why it failed; it no longer
      // counts towards the pre-submit limit.
      await this.taskStore.deleteLocal(record.id);
      this.broadcast();
      this.onChange();
      throw err;
    }
  }

  /**
   * Called when a task reached a terminal state.
   *
   * The record status has to be updated as well, otherwise the task keeps
   * counting towards the pre-submit limit and the next queued task would
   * never be released.
   */
  markFinished(promptId, status) {
    const record = this.records.get(promptId);
    if (record) {
      record.status = status || STATUS.COMPLETED;
    }
    this.dispatch();
  }

  /** Record the moment ComfyUI really started executing a task. */
  markRunning(promptId, startedAt) {
    const record = this.records.get(promptId);
    if (!record) return null;
    if (record.executionStartedAt === null || record.executionStartedAt === undefined) {
      record.executionStartedAt = startedAt;
    }
    record.status = STATUS.RUNNING;
    this.onChange();
    return record;
  }
}
