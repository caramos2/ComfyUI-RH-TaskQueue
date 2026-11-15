/**
 * ComfyUI-RH-TaskQueue - extension entry point.
 *
 * This is the only file that registers an extension. Everything else is a
 * plain module so the frontend can import it without treating it as a second
 * extension entry point.
 *
 * What this controller does:
 *   1. picks a data source (Jobs API first, legacy /queue + /history second),
 *   2. keeps one merged view of every task it knows about,
 *   3. dispatches the plugin's own queue up to the pre-submit limit,
 *   4. turns finished tasks into duration samples and notifications.
 */

import { app } from '/scripts/app.js';
import { ApiClient } from './core/api_client.js';
import { Settings } from './core/settings.js';
import { TaskStore } from './core/task_store.js';
import { QueueManager } from './core/queue_manager.js';
import { EventBridge } from './core/event_bridge.js';
import { Notifier } from './core/notifier.js';
import { JobsApiAdapter } from './adapters/jobs_api.js';
import { LegacyApiAdapter } from './adapters/legacy_api.js';
import { Drawer } from './ui/drawer.js';
import { computeSignature } from './core/fingerprint.js';
import {
  STATUS,
  formatDuration,
  isTerminal,
  mergeRecord,
} from './core/task_model.js';

const STATUS_RANK = {
  [STATUS.RUNNING]: 0,
  [STATUS.BACKEND_PENDING]: 1,
  [STATUS.PLUGIN_QUEUED]: 2,
  [STATUS.SUBMIT_FAILED]: 3,
  [STATUS.FAILED]: 4,
  [STATUS.CANCELLED]: 4,
  [STATUS.COMPLETED]: 5,
};

class TaskQueueController {
  constructor() {
    this.apiClient = new ApiClient();
    this.settings = new Settings();
    this.taskStore = new TaskStore();
    this.notifier = new Notifier(this.settings);
    this.records = new Map();
    this.handled = new Set();
    this.signatureByWorkflowId = new Map();
    this.estimates = new Map();
    this.adapter = null;
    this.drawer = null;
    this.queueManager = null;
    this.eventBridge = null;
    this.pollTimer = null;
    this.tickTimer = null;
    this.busy = false;
    this.verifyPending = new Set();
  }

  async init(comfyApp) {
    this.app = comfyApp;

    this.drawer = new Drawer({
      settings: this.settings,
      onAction: (action, payload) => this.handleAction(action, payload),
    });
    this.drawer.mount(document.body);
    this.drawer.estimates = this.estimates;

    const jobsAdapter = new JobsApiAdapter(this.apiClient);
    if (await jobsAdapter.supported()) {
      this.adapter = jobsAdapter;
    } else {
      const legacyAdapter = new LegacyApiAdapter(this.apiClient);
      this.adapter = (await legacyAdapter.supported()) ? legacyAdapter : jobsAdapter;
    }
    this.drawer.setMode(this.adapter.mode === 'jobs_api' ? 'Jobs API 模式' : 'Legacy 模式');

    try {
      const health = await this.apiClient.health();
      if (health && health.caps) {
        const parts = [];
        if (health.caps.jobs_api) parts.push('Jobs API');
        if (health.caps.legacy_api) parts.push('Legacy');
        if (health.caps.cancel_api) parts.push('可取消');
        this.drawer.setMode(
          (this.adapter.mode === 'jobs_api' ? 'Jobs API 模式' : 'Legacy 模式') +
            (parts.includes('可取消') ? ' · 可取消' : ''),
        );
      }
    } catch (err) {
      this.drawer.setMode('耗时库未就绪');
    }

    this.queueManager = new QueueManager({
      apiClient: this.apiClient,
      taskStore: this.taskStore,
      settings: this.settings,
      onChange: () => this.render(),
    });
    await this.queueManager.start();

    this.eventBridge = new EventBridge({
      onEvent: (type, data) => this.handleEvent(type, data),
    });
    this.eventBridge.start();

    this.tickTimer = setInterval(() => {
      if (this.drawer) this.drawer.updateTimings();
    }, 1000);

    await this.sync();
    this.scheduleNext(1200);
  }

  // -- data ---------------------------------------------------------------

  hasActiveTasks() {
    for (const record of this.records.values()) {
      if (
        record.status === STATUS.RUNNING ||
        record.status === STATUS.BACKEND_PENDING ||
        record.status === STATUS.PLUGIN_QUEUED
      ) {
        return true;
      }
    }
    return false;
  }

  async sync() {
    if (this.busy) return;
    this.busy = true;
    try {
      const backendRecords = await this.adapter.list({ limit: 60 });
      // Handle the finished jobs oldest first: the duration archive keeps
      // the most recent run as "last", so it must be written last.
      const ordered = backendRecords
        .slice()
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      for (const record of ordered) {
        const existing = this.records.get(record.id);
        let merged = existing ? mergeRecord(existing, record) : record;
        const pluginRecord = this.queueManager.records.get(record.id);
        if (pluginRecord) {
          merged.origin = 'plugin';
          merged.workflowName = merged.workflowName || pluginRecord.workflowName;
          merged.signature = merged.signature || pluginRecord.signature;
          if (
            (merged.executionStartedAt === null ||
              merged.executionStartedAt === undefined) &&
            pluginRecord.executionStartedAt
          ) {
            merged.executionStartedAt = pluginRecord.executionStartedAt;
          }
        }
        if (!merged.signature && merged.workflowId) {
          const hint = this.signatureByWorkflowId.get(merged.workflowId);
          if (hint) merged.signatureHint = hint;
        }
        this.records.set(record.id, merged);

        if (isTerminal(merged.status) && !this.handled.has(merged.id)) {
          await this.handleTerminal(merged);
        }
      }

      // Plugin side tasks that the backend does not know about yet.
      for (const record of this.queueManager.getAll()) {
        if (!this.records.has(record.id)) this.records.set(record.id, record);
      }
      // A submitted plugin task changes its id from "local-..." to its
      // prompt id. Drop the stale entry so no phantom card is left behind.
      for (const [id, record] of Array.from(this.records.entries())) {
        if (record.origin === 'plugin' && !this.queueManager.records.has(id)) {
          this.records.delete(id);
        }
      }

      await this.refreshEstimates();
    } catch (err) {
      console.warn('[rh_queue] sync failed:', err && err.message);
    } finally {
      this.busy = false;
      this.render();
    }
  }

  async refreshEstimates() {
    const wanted = new Set();
    for (const record of this.records.values()) {
      const signature = record.signature || record.signatureHint;
      if (signature) wanted.add(signature);
    }
    for (const signature of wanted) {
      if (this.estimates.has(signature)) continue;
      try {
        const estimate = await this.apiClient.estimate(signature);
        this.estimates.set(signature, estimate);
      } catch (err) {
        /* the reference duration is optional */
      }
    }
  }

  async handleTerminal(record) {
    this.handled.add(record.id);
    let merged = record;
    try {
      const detail = await this.adapter.detail(record.id);
      if (detail) merged = mergeRecord(record, detail);
      this.records.set(merged.id, merged);

      let signature = merged.signature;
      const prompt = merged.workflow && merged.workflow.prompt;
      if (!signature && prompt) {
        try {
          const computed = computeSignature(prompt);
          signature = computed.signature;
          merged.signature = signature;
          merged.signature_version = computed.signature_version;
        } catch (err) {
          /* a workflow we cannot fingerprint simply has no reference duration */
        }
      }
      if (merged.workflowId && signature) {
        this.signatureByWorkflowId.set(merged.workflowId, signature);
      }

      if (
        merged.status === STATUS.COMPLETED &&
        merged.executionSeconds &&
        merged.executionSeconds > 0 &&
        signature
      ) {
        try {
          await this.apiClient.recordDuration({
            signature,
            signature_version: merged.signature_version || 1,
            duration: merged.executionSeconds,
            prompt_id: merged.id,
          });
          // Re-read the authoritative numbers instead of guessing them
          // locally: the backend knows the real sample count.
          this.estimates.delete(signature);
          try {
            const fresh = await this.apiClient.estimate(signature);
            this.estimates.set(signature, fresh);
          } catch (err) {
            /* the next refresh will pick it up */
          }
        } catch (err) {
          /* keep the sample for the next attempt */
        }
      }

      const durationText = formatDuration(merged.executionSeconds);
      if (merged.status === STATUS.COMPLETED) {
        this.notifier.announceSuccess(merged, {
          durationText,
          outputCount: merged.outputsCount || 0,
        });
      } else if (merged.status === STATUS.FAILED || merged.status === STATUS.CANCELLED) {
        const message =
          (merged.error && (merged.error.exception_message || merged.error.exception_type)) ||
          '';
        this.notifier.announceFailure(merged, { durationText, message });
      }
    } catch (err) {
      console.warn('[rh_queue] terminal handling failed:', err && err.message);
    } finally {
      if (this.queueManager) this.queueManager.markFinished(record.id, merged.status);
    }
  }

  // -- events -------------------------------------------------------------

  handleEvent(type, data) {
    const promptId = data && (data.prompt_id || data.promptId);
    if (!promptId) return;
    if (type === 'execution_start') {
      const record = this.records.get(promptId);
      if (record) {
        if (record.executionStartedAt === null || record.executionStartedAt === undefined) {
          record.executionStartedAt = Date.now();
        }
        record.status = STATUS.RUNNING;
      }
      if (this.queueManager) this.queueManager.markRunning(promptId, Date.now());
      this.render();
      this.scheduleNext(600);
      return;
    }
    // A terminal event only hints at the outcome; the API decides.
    this.verifyPending.add(promptId);
    this.scheduleNext(400);
  }

  scheduleNext(delay) {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = setTimeout(async () => {
      await this.sync();
      const open = Boolean(this.settings.get('drawerOpen'));
      const next = open ? 2500 : this.hasActiveTasks() ? 8000 : 30000;
      this.scheduleNext(next);
    }, delay);
  }

  // -- rendering ----------------------------------------------------------

  render() {
    if (!this.drawer) return;
    const list = Array.from(this.records.values()).sort((a, b) => {
      const rankA = STATUS_RANK[a.status] ?? 9;
      const rankB = STATUS_RANK[b.status] ?? 9;
      if (rankA !== rankB) return rankA - rankB;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    let running = 0;
    let pending = 0;
    let queued = 0;
    for (const record of list) {
      if (record.status === STATUS.RUNNING) running += 1;
      else if (record.status === STATUS.BACKEND_PENDING) pending += 1;
      else if (record.status === STATUS.PLUGIN_QUEUED) queued += 1;
    }
    this.drawer.records = list;
    this.drawer.stats = { running, pending, queued };
    this.drawer.render();
  }

  // -- actions ------------------------------------------------------------

  async snapshotCurrentGraph() {
    const comfyApp = this.app;
    if (!comfyApp || typeof comfyApp.graphToPrompt !== 'function') {
      throw new Error('无法访问当前工作流');
    }
    const result = await comfyApp.graphToPrompt();
    const output = result && result.output;
    if (!output || !Object.keys(output).length) {
      throw new Error('当前工作流为空，无法加入队列');
    }
    const workflow = (result && result.workflow) || null;
    const name = (workflow && workflow.name) || '未命名工作流';
    return { prompt: output, workflow, name };
  }

  async handleAction(action, payload) {
    switch (action) {
      case 'enqueue': {
        try {
          const snapshot = await this.snapshotCurrentGraph();
          await this.queueManager.enqueue(snapshot);
        } catch (err) {
          console.warn('[rh_queue] enqueue failed:', err && err.message);
        }
        break;
      }
      case 'pause':
        this.settings.set('paused', Boolean(payload));
        this.queueManager.dispatch();
        break;
      case 'limit':
        this.settings.set('preSubmitLimit', Math.max(1, Math.min(8, Number(payload) || 1)));
        this.queueManager.dispatch();
        break;
      case 'sound':
        this.settings.set('soundEnabled', Boolean(payload));
        if (payload) this.notifier.unlock();
        break;
      case 'notify': {
        this.settings.set('notifyEnabled', Boolean(payload));
        if (payload) {
          const permission = await this.notifier.requestPermission();
          if (permission !== 'granted') {
            this.settings.set('notifyEnabled', false);
            if (this.drawer) this.drawer.elements.notify.checked = false;
          }
        }
        break;
      }
      case 'test-sound':
        this.notifier.playChime();
        break;
      case 'cancel': {
        try {
          await this.adapter.cancel(payload.id);
        } catch (err) {
          console.warn('[rh_queue] cancel failed:', err && err.message);
        }
        this.scheduleNext(200);
        break;
      }
      case 'remove':
        await this.queueManager.remove(payload.id);
        break;
      default:
        break;
    }
  }
}

const controller = new TaskQueueController();

// Debug hook: lets the browser console (and automated checks) inspect the
// live controller state. Read-only, it exposes no new capabilities.
if (typeof window !== 'undefined') {
  window.__rhTaskQueue = controller;
}

app.registerExtension({
  name: 'ComfyUI-RH-TaskQueue',
  async setup(comfyApp) {
    try {
      await controller.init(comfyApp);
    } catch (err) {
      console.error('[rh_queue] initialisation failed:', err);
    }
  },
});
