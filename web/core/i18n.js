/**
 * A very small i18n layer.
 *
 * The plugin ships without a build step and without third party dependencies,
 * so the language packs are plain ES modules and the lookup is a flat object.
 *
 * Three rules shape this module:
 *   - the language follows the browser until the user pins one,
 *   - a pinned language survives a reload (localStorage),
 *   - a key that is missing in the active language falls back to the default
 *     language, so a half translated pack never blanks the UI.
 *
 * The browser is detected through `window.navigator`, so outside a browser
 * (unit tests, tooling) the default language is used and the behaviour stays
 * deterministic.
 */

import { zhCN } from '../locales/zh-CN.js';
import { en } from '../locales/en.js';

export const DEFAULT_LANG = 'zh-CN';
export const SUPPORTED_LANGS = ['zh-CN', 'en'];
export const PACKAGES = { 'zh-CN': zhCN, en };
export const STORAGE_KEY = 'rh_taskqueue_lang';

/** The three choices the language picker offers. */
export const LANGUAGE_CHOICES = [
  { id: 'auto', labelKey: 'language.option.auto' },
  { id: 'zh-CN', labelKey: 'language.option.zh' },
  { id: 'en', labelKey: 'language.option.en' },
];

/**
 * Map a browser language tag onto a supported pack.
 *
 * Anything Chinese maps to the Simplified Chinese pack: a Traditional
 * Chinese browser still gets a translated UI instead of English.
 * Returns null for a language the plugin does not speak.
 */
export function normalizeLang(tag) {
  if (!tag) return null;
  const raw = String(tag).toLowerCase().replace(/_/g, '-');
  if (raw.startsWith('zh')) return 'zh-CN';
  if (raw.startsWith('en')) return 'en';
  return null;
}

/**
 * The browser's preferred language, or null when there is no browser.
 */
export function detectLanguage() {
  if (typeof window === 'undefined') return null;
  const nav = window.navigator;
  if (!nav) return null;
  const candidates = [];
  if (Array.isArray(nav.languages)) candidates.push(...nav.languages);
  if (nav.language) candidates.push(nav.language);
  for (const tag of candidates) {
    const lang = normalizeLang(tag);
    if (lang) return lang;
  }
  return null;
}

function safeStorage() {
  if (typeof window === 'undefined') return null;
  try {
    const probe = '__rh_tq_lang_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

/** Fill {placeholders} from a parameter object. */
function interpolate(text, params) {
  if (!params) return text;
  return String(text).replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

export class I18n {
  constructor(options = {}) {
    this.storage = options.storage !== undefined ? options.storage : safeStorage();
    this.preference = this._readPreference();
    this.detected = null;
    this.detectedResolved = false;
    this.listeners = new Set();
  }

  _readPreference() {
    if (!this.storage) return 'auto';
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (raw === 'zh-CN' || raw === 'en' || raw === 'auto') return raw;
    } catch (err) {
      /* an unreadable storage just means "follow the browser" */
    }
    return 'auto';
  }

  /** The language actually in use: the pinned one, else the browser's. */
  get lang() {
    if (this.preference === 'zh-CN' || this.preference === 'en') return this.preference;
    if (!this.detectedResolved) {
      this.detected = detectLanguage();
      this.detectedResolved = true;
    }
    return this.detected || DEFAULT_LANG;
  }

  /**
   * Pin a language, or pass 'auto' to follow the browser again.
   * Returns the language that is in use afterwards.
   */
  setLanguage(preference) {
    const value =
      preference === 'zh-CN' || preference === 'en' ? preference : 'auto';
    if (value !== this.preference) {
      this.preference = value;
      try {
        if (this.storage) this.storage.setItem(STORAGE_KEY, value);
      } catch (err) {
        /* keep the in-memory preference */
      }
      this._notify();
    }
    return this.lang;
  }

  /** Listen for language changes. Returns a function that stops listening. */
  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _notify() {
    const lang = this.lang;
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(lang);
      } catch (err) {
        console.warn('[rh_queue] language listener failed:', err && err.message);
      }
    }
  }

  /** Translate a key. Unknown keys are returned as they are. */
  t(key, params) {
    if (!key) return '';
    const active = PACKAGES[this.lang];
    let text = active ? active[key] : undefined;
    if (text === undefined) text = PACKAGES[DEFAULT_LANG][key];
    if (text === undefined) return key;
    return interpolate(text, params);
  }
}

/** The shared instance the plugin uses. */
export const i18n = new I18n();

/** Shortcut for the shared instance. */
export function t(key, params) {
  return i18n.t(key, params);
}
