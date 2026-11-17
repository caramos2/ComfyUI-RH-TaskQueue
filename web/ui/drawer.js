/**
 * The right hand task drawer.
 *
 * It is a plain DOM component inside a shadow root: it never fetches
 * anything itself, it only renders what the controller hands it.
 *
 * Every visible string goes through the i18n layer. The static labels are
 * registered as bindings, so switching the language rewrites them in place
 * instead of rebuilding the whole drawer (which would lose the scroll
 * position of the list).
 */

import { CSS } from './styles.js';
import { renderTaskCard } from './task_card.js';
import { STATUS, formatDuration, liveExecutionSeconds, liveQueueWaitSeconds } from '../core/task_model.js';
import { i18n as sharedI18n, LANGUAGE_CHOICES } from '../core/i18n.js';

const FILTERS = [
  { id: 'all', labelKey: 'drawer.filter.all' },
  { id: 'running', labelKey: 'drawer.filter.running' },
  { id: 'queued', labelKey: 'drawer.filter.queued' },
  { id: 'done', labelKey: 'drawer.filter.done' },
  { id: 'failed', labelKey: 'drawer.filter.failed' },
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
  constructor({ settings, onAction, i18n } = {}) {
    this.settings = settings;
    this.onAction = onAction || (() => {});
    this.i18n = i18n || sharedI18n;
    this.host = null;
    this.shadow = null;
    this.records = [];
    this.stats = { running: 0, pending: 0, queued: 0 };
    this.filter = this.settings.get('filter') || 'all';
    this.estimates = new Map();
    this.elements = {};
    this.bindings = [];
    this.modeKey = 'drawer.mode.connecting';
    this.modeCancellable = false;
    this.unsubscribe = null;
  }

  /** Translate through the injected language layer. */
  t(key, params) {
    return this.i18n.t(key, params);
  }

  /**
   * Register a static label so a language change can rewrite it in place.
   */
  _bind(element, key, params) {
    element.textContent = this.t(key, params);
    this.bindings.push({ element, key, params });
    return element;
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
    this._bind(tabLabel, 'drawer.tab');
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
    this._bind(title, 'drawer.title');
    head.appendChild(title);
    const mode = document.createElement('span');
    mode.className = 'rh-tq-mode';
    mode.textContent = this.t('drawer.mode.connecting');
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
      ['running', 'drawer.stat.running'],
      ['pending', 'drawer.stat.pending'],
      ['queued', 'drawer.stat.queued'],
    ];
    this.elements.stats = {};
    for (const [key, labelKey] of statDefs) {
      const stat = document.createElement('div');
      stat.className = 'rh-tq-stat rh-tq-stat--' + key;
      const num = document.createElement('div');
      num.className = 'rh-tq-stat__num';
      num.textContent = '0';
      const cap = document.createElement('div');
      cap.className = 'rh-tq-stat__label';
      this._bind(cap, labelKey);
      stat.appendChild(num);
      stat.appendChild(cap);
      summary.appendChild(stat);
      this.elements.stats[key] = num;
    }
    panel.appendChild(summary);

    const controls = document.createElement('div');
    controls.className = 'rh-tq-controls';

    const limitLabel = document.createElement('label');
    limitLabel.appendChild(this._bind(document.createElement('span'), 'drawer.control.limit'));
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
    pauseLabel.appendChild(
      this._bind(document.createElement('span'), 'drawer.control.autoDispatch'),
    );
    controls.appendChild(pauseLabel);

    const soundLabel = document.createElement('label');
    const sound = document.createElement('input');
    sound.type = 'checkbox';
    sound.checked = Boolean(this.settings.get('soundEnabled'));
    sound.addEventListener('change', () => this.onAction('sound', sound.checked));
    soundLabel.appendChild(sound);
    soundLabel.appendChild(
      this._bind(document.createElement('span'), 'drawer.control.sound'),
    );
    controls.appendChild(soundLabel);

    const notifyLabel = document.createElement('label');
    const notify = document.createElement('input');
    notify.type = 'checkbox';
    notify.checked = Boolean(this.settings.get('notifyEnabled'));
    notify.addEventListener('change', () => this.onAction('notify', notify.checked));
    notifyLabel.appendChild(notify);
    notifyLabel.appendChild(
      this._bind(document.createElement('span'), 'drawer.control.notify'),
    );
    controls.appendChild(notifyLabel);

    const enqueue = document.createElement('button');
    enqueue.className = 'rh-tq-btn rh-tq-btn--primary';
    enqueue.type = 'button';
    this._bind(enqueue, 'drawer.control.enqueue');
    enqueue.addEventListener('click', () => this.onAction('enqueue', null));
    controls.appendChild(enqueue);

    const testSound = document.createElement('button');
    testSound.className = 'rh-tq-btn';
    testSound.type = 'button';
    this._bind(testSound, 'drawer.control.testSound');
    testSound.addEventListener('click', () => this.onAction('test-sound', null));
    controls.appendChild(testSound);

    const languageLabel = document.createElement('label');
    languageLabel.className = 'rh-tq-lang';
    languageLabel.appendChild(
      this._bind(document.createElement('span'), 'drawer.control.language'),
    );
    const language = document.createElement('select');
    language.className = 'rh-tq-select';
    language.dataset.testid = 'rh-taskqueue-language';
    for (const choice of LANGUAGE_CHOICES) {
      const option = document.createElement('option');
      option.value = choice.id;
      option.textContent = this.t(choice.labelKey);
      if (choice.id === this.i18n.preference) option.selected = true;
      language.appendChild(option);
      this.bindings.push({ element: option, key: choice.labelKey, params: null });
    }
    language.addEventListener('change', () => this.onAction('language', language.value));
    languageLabel.appendChild(language);
    controls.appendChild(languageLabel);
    this.elements.language = language;

    const hint = document.createElement('div');
    hint.className = 'rh-tq-hint';
    this._bind(hint, 'drawer.control.hint');
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
      this._bind(button, filter.labelKey);
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

    // A language change rewrites every label in place.
    this.unsubscribe = this.i18n.subscribe(() => this.applyLanguage());
    return this;
  }

  /**
   * The data source badge.
   *
   * The key is stored instead of the text, so switching the language also
   * rewrites the badge.
   */
  setMode(key, options = {}) {
    this.modeKey = key;
    this.modeCancellable = Boolean(options.cancellable);
    this._applyMode();
  }

  _applyMode() {
    if (!this.elements.mode) return;
    let text = this.t(this.modeKey);
    if (this.modeCancellable) text += this.t('drawer.mode.cancellable');
    this.elements.mode.textContent = text;
  }

  /** Rewrite every registered label after a language change. */
  applyLanguage() {
    for (const binding of this.bindings) {
      binding.element.textContent = this.t(binding.key, binding.params);
    }
    this._applyMode();
    if (this.elements.language) {
      this.elements.language.value = this.i18n.preference;
    }
    this.render();
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

  /**
   * Keep the panel clear of ComfyUI's own toolbar.
   *
   * The panel sits on the right edge of the window and would otherwise
   * cover the toolbar row - which carries both ComfyUI's queue button and
   * the plugin's own run button.
   */
  setTopOffset(pixels) {
    if (!this.elements.panel) return;
    const value = Math.max(8, Math.round(Number(pixels) || 0));
    this.elements.panel.style.setProperty('--rh-tq-top', value + 'px');
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
      empty.textContent =
        this.filter === 'all' ? this.t('drawer.empty.all') : this.t('drawer.empty.filtered');
      list.appendChild(empty);
    } else {
      for (const record of visible) {
        // Reference durations are keyed by workflow signature, not by task id.
        const signature = record.signature || record.signatureHint;
        const card = renderTaskCard(record, {
          onAction: this.onAction,
          estimate: signature ? this.estimates.get(signature) || null : null,
          now: Date.now(),
          i18n: this.i18n,
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
        text = this.t('timing.running') + formatDuration(liveExecutionSeconds(record, now));
      } else if (record.status === STATUS.BACKEND_PENDING) {
        text = this.t('timing.backendWaiting') + formatDuration(liveQueueWaitSeconds(record, now));
      } else if (record.status === STATUS.PLUGIN_QUEUED) {
        text = this.t('timing.pluginQueued') + formatDuration(liveQueueWaitSeconds(record, now));
      }
      if (text) timing.textContent = text;
    }
  }

  destroy() {
    if (this.unsubscribe) this.unsubscribe();
    this.unsubscribe = null;
    if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
    this.host = null;
  }
}
