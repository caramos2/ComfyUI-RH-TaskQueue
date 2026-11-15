/**
 * Persistence for tasks that live in the plugin's own queue.
 *
 * Only the plugin-side tasks are stored here. Tasks that were already handed
 * to ComfyUI are rebuilt from the Jobs API, so a page reload never loses a
 * submitted job.
 *
 * IndexedDB is used because a workflow snapshot can be large; localStorage
 * would both waste quota and block the main thread. When IndexedDB is not
 * available the store degrades to an in-memory map instead of failing.
 */

const DB_NAME = 'rh-taskqueue';
const DB_VERSION = 1;
const STORE_NAME = 'local_tasks';

export class TaskStore {
  constructor() {
    this.db = null;
    this.memory = new Map();
    this.ready = false;
  }

  async open() {
    if (this.ready) return this.db;
    if (typeof indexedDB === 'undefined') {
      this.ready = true;
      return null;
    }
    this.db = await new Promise((resolve) => {
      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        resolve(null);
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
    this.ready = true;
    return this.db;
  }

  _tx(mode) {
    if (!this.db) return null;
    try {
      return this.db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
    } catch (err) {
      return null;
    }
  }

  async putLocal(record) {
    if (!record || !record.id) return null;
    await this.open();
    const store = this._tx('readwrite');
    if (!store) {
      this.memory.set(record.id, record);
      return record;
    }
    await new Promise((resolve) => {
      const request = store.put(record);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
    return record;
  }

  async listLocal() {
    await this.open();
    const store = this._tx('readonly');
    if (!store) return Array.from(this.memory.values());
    const records = await new Promise((resolve) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => resolve([]);
    });
    return records;
  }

  async deleteLocal(id) {
    await this.open();
    const store = this._tx('readwrite');
    if (!store) {
      this.memory.delete(id);
      return true;
    }
    await new Promise((resolve) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
    return true;
  }

  async clearLocal() {
    await this.open();
    const store = this._tx('readwrite');
    if (!store) {
      this.memory.clear();
      return true;
    }
    await new Promise((resolve) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => resolve();
    });
    return true;
  }
}
