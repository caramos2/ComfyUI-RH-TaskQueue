/**
 * User settings, persisted in localStorage.
 *
 * The storage access is wrapped because private browsing modes can throw on
 * both read and write; in that case the plugin keeps working with the
 * in-memory defaults.
 */

const STORAGE_KEY = 'rh_taskqueue_settings';

export const DEFAULTS = {
  preSubmitLimit: 1,
  paused: false,
  soundEnabled: true,
  soundVolume: 0.3,
  notifyEnabled: false,
  notifyOnFailure: true,
  filter: 'all',
  drawerOpen: false,
  drawerWidth: 380,
};

function safeStorage() {
  try {
    const probe = '__rh_tq_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch (err) {
    return null;
  }
}

export class Settings {
  constructor(storage) {
    this.storage = storage !== undefined ? storage : safeStorage();
    this.values = Object.assign({}, DEFAULTS, this._read());
  }

  _read() {
    if (!this.storage) return {};
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (err) {
      return {};
    }
  }

  _write() {
    if (!this.storage) return;
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch (err) {
      /* keep going with in-memory values */
    }
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    this.values[key] = value;
    this._write();
    return value;
  }

  patch(patch) {
    if (!patch) return this.values;
    Object.assign(this.values, patch);
    this._write();
    return this.values;
  }

  load() {
    return Object.assign({}, this.values);
  }

  save(patch) {
    return this.patch(patch);
  }
}
