/**
 * The right hand task drawer.
 *
 * It is a plain DOM component inside a shadow root: it never fetches
 * anything itself, it only renders what the controller hands it.
 */

import { CSS } from './styles.js';
import { renderTaskCard } from './task_card.js';
import { STATUS, formatDuration, liveExecutionSeconds, liveQueueWaitSeconds } from '../core/task_model.js';

const FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'running', label: '运行中' },
  { id: 'queued', label: '排队中' },
  { id: 'done', label: '已完成' },
  { id: 'failed', label: '失败' },
];

function matchesFilter(record, filter) {
  switch (filter) {
    case 'running':
      return record.status === STATUS.RUNNING;
    case 'queued':
      return (
        record.status === STATUS.PLUGIN_QUEUED ||
        record.status === STATUS.BACKEND_PENDING
      );
    case 'done':
      return record.status === STATUS.COMPLETED;
    case 'failed':
      return (
        record.status === STATUS.FAILED ||
        record.status === STATUS.CANCELLED ||
        record.status === STATUS.SUBMIT_FAILED
      );
    default:
      return true;
  }
}

export class Drawer {
  constructor({ settings, onAction }) {
    this.settings = settings;
    this.onAction = onAction || (() => {});
    this.host = null;
    this.shadow = null;
    this.records = [];
    this.stats = { running: 0, pending: 0, queued: 0 };
    this.filter = this.settings.get('filter') || 'all';
    this.estimates = new Map();
    this.elements = {};
  }

  mount(root) {
    const parent = root || document.body;
    this.host = document.createElement('div');
    this.host.className = 'rh-tq-host';
    this.host.style.position = 'fixed';
    this.host.style.top = '0';
    this.host.style.left = '0';
    this.host.style.width = '100%';
    this.host.style.height = '0';
    this.host.style.zIndex = '10000';
    this.host.style.pointerEvents = 'none';

    this.shadow = this.host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    this.shadow.appendChild(style);

    const tab = document.createElement('button');
    tab.className = 'rh-tq-tab';
    tab.type = 'button';
    const tabLabel = document.createElement('span');
    tabLabel.textContent = '任务队列';
    const tabBadge = document.createElement('span');
    tabBadge.className = 'rh-tq-tab__badge';
    tabBadge.textContent = '0';
    tab.appendChild(tabLabel);
    tab.appendChild(tabBadge);
    tab.addEventListener('click', () => this.toggle());
    this.shadow.appendChild(tab);
    this.elements.tabBadge = tabBadge;

    const panel = document.createElement('div');
    panel.className = 'rh-tq-panel';
    panel.style.setProperty('--rh-tq-width', this.settings.get('drawerWidth') + 'px');
    this.shadow.appendChild(panel);
    this.elements.panel = panel;

    const head = document.createElement('div');
    head.className = 'rh-tq-head';
    const title = document.createElement('span');
    title.className = 'rh-tq-head__title';
    title.textContent = '任务队列';
    head.appendChild(title);
    const mode = document.createElement('span');
    mode.className = 'rh-tq-mode';
    mode.textContent = '连接中';
    head.appendChild(mode);
    const close = document.createElement('button');
    close.className = 'rh-tq-iconbtn';
    close.type = 'button';
    close.textContent = '×';
    close.addEventListener('click', () => this.toggle(false));
    head.appendChild(close);
    panel.appendChild(head);
    this.elements.mode = mode;

    const summary = document.createElement('div');
    summary.className = 'rh-tq-summary';
    const statDefs = [
      ['running', '运行中'],
      ['pending', '后端排队'],
      ['queued', '本地排队'],
    ];
    this.elements.stats = {};
    for (const [key, label] of statDefs) {
      const stat = document.createElement('div');
      stat.className = 'rh-tq-stat rh-tq-stat--' + key;
      const num = document.createElement('div');
      num.className = 'rh-tq-stat__num';
      num.textContent = '0';
      const cap = document.createElement('div');
      cap.className = 'rh-tq-stat__label';
      cap.textContent = label;
      stat.appendChild(num);
      stat.appendChild(cap);
      summary.appendChild(stat);
      this.elements.stats[key] = num;
    }
    panel.appendChild(summary);

    const controls = document.createElement('div');
    controls.className = 'rh-tq-controls';

    const limitLabel = document.createElement('label');
    limitLabel.textContent = '预提交上限';
    const limit = document.createElement('select');
    limit.className = 'rh-tq-select';
    for (let value = 1; value <= 8; value += 1) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = String(value);
      if (value === Number(this.settings.get('preSubmitLimit'))) option.selected = true;
      limit.appendChild(option);
    }
    limit.addEventListener('change', () => {
      this.onAction('limit', Number(limit.value));
    });
    limitLabel.appendChild(limit);
    controls.appendChild(limitLabel);

    const pauseLabel = document.createElement('label');
    const pause = document.createElement('input');
    pause.type = 'checkbox';
    pause.checked = !this.settings.get('paused');
    pause.addEventListener('change', () => this.onAction('pause', !pause.checked));
    pauseLabel.appendChild(pause);
    pauseLabel.appendChild(document.createTextNode('自动派发'));
    controls.appendChild(pauseLabel);

    const soundLabel = document.createElement('label');
    const sound = document.createElement('input');
    sound.type = 'checkbox';
    sound.checked = Boolean(this.settings.get('soundEnabled'));
    sound.addEventListener('change', () => this.onAction('sound', sound.checked));
    soundLabel.appendChild(sound);
    soundLabel.appendChild(document.createTextNode('声音'));
    controls.appendChild(soundLabel);

    const notifyLabel = document.createElement('label');
    const notify = document.createElement('input');
    notify.type = 'checkbox';
    notify.checked = Boolean(this.settings.get('notifyEnabled'));
    notify.addEventListener('change', () => this.onAction('notify', notify.checked));
    notifyLabel.appendChild(notify);
    notifyLabel.appendChild(document.createTextNode('通知'));
    controls.appendChild(notifyLabel);

    const enqueue = document.createElement('button');
    enqueue.className = 'rh-tq-btn rh-tq-btn--primary';
    enqueue.type = 'button';
    enqueue.textContent = '加入任务队列';
    enqueue.addEventListener('click', () => this.onAction('enqueue', null));
    controls.appendChild(enqueue);

    const testSound = document.createElement('button');
    testSound.className = 'rh-tq-btn';
    testSound.type = 'button';
    testSound.textContent = '测试音效';
    testSound.addEventListener('click', () => this.onAction('test-sound', null));
    controls.appendChild(testSound);

    const hint = document.createElement('div');
    hint.className = 'rh-tq-hint';
    hint.textContent =
      '预提交上限只控制提前交给 ComfyUI 的任务数量，不代表 GPU 并行数。';
    controls.appendChild(hint);
    panel.appendChild(controls);
    this.elements.pause = pause;
    this.elements.sound = sound;
    this.elements.notify = notify;

    const filters = document.createElement('div');
    filters.className = 'rh-tq-filters';
    this.elements.filters = {};
    for (const filter of FILTERS) {
      const button = document.createElement('button');
      button.className = 'rh-tq-filter';
      button.type = 'button';
      button.textContent = filter.label;
      button.addEventListener('click', () => this.setFilter(filter.id));
      filters.appendChild(button);
      this.elements.filters[filter.id] = button;
    }
    panel.appendChild(filters);

    const list = document.createElement('div');
    list.className = 'rh-tq-list';
    panel.appendChild(list);
    this.elements.list = list;

    parent.appendChild(this.host);
    this.setFilter(this.filter);
    this.applyOpenState();
    return this;
  }

  setMode(text) {
    if (this.elements.mode) this.elements.mode.textContent = text;
  }

  setFilter(filter) {
    this.filter = filter;
    this.settings.set('filter', filter);
    for (const [id, button] of Object.entries(this.elements.filters || {})) {
      button.classList.toggle('is-active', id === filter);
    }
    this.render();
  }

  toggle(force) {
    const open = force === undefined ? !this.settings.get('drawerOpen') : force;
    this.settings.set('drawerOpen', open);
    this.applyOpenState();
  }

  applyOpenState() {
    if (!this.elements.panel) return;
    this.elements.panel.classList.toggle('is-open', Boolean(this.settings.get('drawerOpen')));
  }

  setEstimate(id, estimate) {
    this.estimates.set(id, estimate);
  }

  render() {
    const list = this.elements.list;
    if (!list) return;
    list.textContent = '';

    const visible = this.records.filter((record) => matchesFilter(record, this.filter));
    if (!visible.length) {
      const empty = document.createElement('div');
      empty.className = 'rh-tq-empty';
      empty.textContent = this.filter === 'all' ? '暂无任务' : '该分类下暂无任务';
      list.appendChild(empty);
    } else {
      for (const record of visible) {
        // Reference durations are keyed by workflow signature, not by task id.
        const signature = record.signature || record.signatureHint;
        const card = renderTaskCard(record, {
          onAction: this.onAction,
          estimate: signature ? this.estimates.get(signature) || null : null,
          now: Date.now(),
        });
        list.appendChild(card);
      }
    }

    const stats = this.stats;
    if (this.elements.stats.running) this.elements.stats.running.textContent = String(stats.running || 0);
    if (this.elements.stats.pending) this.elements.stats.pending.textContent = String(stats.pending || 0);
    if (this.elements.stats.queued) this.elements.stats.queued.textContent = String(stats.queued || 0);
    if (this.elements.tabBadge) {
      const total = (stats.running || 0) + (stats.pending || 0) + (stats.queued || 0);
      this.elements.tabBadge.textContent = String(total);
    }
  }

  /** Refresh only the timing lines, so a running task ticks without a re-render. */
  updateTimings(now = Date.now()) {
    const list = this.elements.list;
    if (!list) return;
    for (const card of list.querySelectorAll('.rh-tq-card')) {
      const id = card.dataset.rhTqId;
      const record = this.records.find((item) => item.id === id);
      if (!record) continue;
      const timing = card.querySelector('[data-rh-tq-timing]');
      if (!timing) continue;
      let text = '';
      if (record.status === STATUS.RUNNING) {
        text = '已运行 ' + formatDuration(liveExecutionSeconds(record, now));
      } else if (record.status === STATUS.BACKEND_PENDING) {
        text = '后端等待 ' + formatDuration(liveQueueWaitSeconds(record, now));
      } else if (record.status === STATUS.PLUGIN_QUEUED) {
        text = '插件排队 ' + formatDuration(liveQueueWaitSeconds(record, now));
      }
      if (text) timing.textContent = text;
    }
  }

  destroy() {
    if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
    this.host = null;
  }
}
