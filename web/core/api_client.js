/**
 * HTTP access to the two data sources the plugin talks to:
 *   - ComfyUI's own API (/api/jobs, /prompt, /queue, /history)
 *   - the plugin's own backend (/rh_queue/*)
 *
 * URL building follows the frontend's own conventions (verified against
 * comfyui-frontend 1.58.5):
 *   api.apiURL('/api/jobs')  -> <base>/api/jobs   (the /api namespace)
 *   api.fileURL('/rh_queue') -> <base>/rh_queue    (everything else)
 * Mixing those two up would send the plugin's own routes to /api/rh_queue/...
 * and 404, so the two helpers are kept separate on purpose.
 */

import { api } from '/scripts/api.js';

/**
 * The frontend exposes the API object in slightly different shapes across
 * versions, so resolve it defensively instead of assuming one layout.
 */
export function resolveApiInstance() {
  const root = typeof window !== 'undefined' ? window.comfyAPI : null;
  if (!root || !root.api) return null;
  const candidate = root.api;
  if (candidate && typeof candidate.queuePrompt === 'function') return candidate;
  if (candidate.api && typeof candidate.api.queuePrompt === 'function') return candidate.api;
  return candidate;
}

function serverBase() {
  const instance = resolveApiInstance();
  const base = instance && typeof instance.api_base === 'string' ? instance.api_base : '';
  return base;
}

/** URL for a ComfyUI /api/* route. */
export function comfyUrl(path) {
  const instance = resolveApiInstance();
  const suffix = path.startsWith('/api') ? path : '/api' + path;
  if (instance && typeof instance.apiURL === 'function') {
    try {
      return instance.apiURL(suffix);
    } catch (err) {
      /* fall through */
    }
  }
  return serverBase() + suffix;
}

/** URL for a route that lives at the server root (the plugin's own routes). */
export function serverUrl(path) {
  const instance = resolveApiInstance();
  if (instance && typeof instance.fileURL === 'function') {
    try {
      return instance.fileURL(path);
    } catch (err) {
      /* fall through */
    }
  }
  return serverBase() + path;
}

function withParams(url, params) {
  if (!params) return url;
  const separator = url.includes('?') ? '&' : '?';
  const pairs = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    pairs.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
  }
  if (!pairs.length) return url;
  return url + separator + pairs.join('&');
}

export class ApiClient {
  constructor() {
    this.name = 'rh-taskqueue';
  }

  async _request(url, { method = 'GET', body } = {}) {
    const init = {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    };
    if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    let response;
    try {
      response = await fetch(url, init);
    } catch (err) {
      throw new Error('[rh_queue] ' + url + ' network error: ' + err.message);
    }
    if (!response.ok) {
      throw new Error('[rh_queue] ' + url + ' failed with HTTP ' + response.status);
    }
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new Error('[rh_queue] ' + url + ' returned invalid JSON');
    }
  }

  _get(url, params) {
    return this._request(withParams(url, params));
  }

  _post(url, body) {
    return this._request(url, { method: 'POST', body });
  }

  _delete(url) {
    return this._request(url, { method: 'DELETE' });
  }

  // -- plugin backend ----------------------------------------------------

  health() {
    return this._get(serverUrl('/rh_queue/health'));
  }

  estimate(signature, signatureVersion = 1) {
    return this._post(serverUrl('/rh_queue/estimate'), {
      signature,
      signature_version: signatureVersion,
    });
  }

  recordDuration({ signature, signature_version = 1, duration, prompt_id }) {
    return this._post(serverUrl('/rh_queue/record'), {
      signature,
      signature_version,
      duration,
      prompt_id,
    });
  }

  history({ limit = 50, offset = 0 } = {}) {
    return this._get(serverUrl('/rh_queue/history'), { limit, offset });
  }

  deleteHistory(signature) {
    return this._delete(serverUrl('/rh_queue/history/' + encodeURIComponent(signature)));
  }

  /** Workflow id -> title, from the user's saved workflow files. */
  workflowTitles() {
    return this._get(serverUrl('/rh_queue/workflow_titles'));
  }

  /** Ask the backend to show an output file in the OS file manager. */
  revealOutput({ filename, subfolder, type }) {
    return this._post(serverUrl('/rh_queue/reveal'), {
      filename,
      subfolder: subfolder || '',
      type: type || 'output',
    });
  }

  // -- ComfyUI native ----------------------------------------------------

  fetchJobs({ status, limit, offset, sortBy = 'created_at', sortOrder = 'desc' } = {}) {
    return this._get(comfyUrl('/api/jobs'), {
      status: status ? [].concat(status).join(',') : null,
      limit,
      offset,
      sort_by: sortBy,
      sort_order: sortOrder,
    });
  }

  fetchJob(id) {
    return this._get(comfyUrl('/api/jobs/' + encodeURIComponent(id)));
  }

  cancelJob(id) {
    return this._post(comfyUrl('/api/jobs/' + encodeURIComponent(id) + '/cancel'), {});
  }

  fetchQueue() {
    return this._get(serverUrl('/queue'));
  }

  fetchHistory(maxItems) {
    return this._get(serverUrl('/history'), { max_items: maxItems });
  }

  fetchHistoryItem(id) {
    return this._get(serverUrl('/history/' + encodeURIComponent(id)));
  }

  /**
   * Submit a workflow snapshot to ComfyUI.
   *
   * The low level api.queuePrompt() is used on purpose: the plugin submits a
   * frozen snapshot and needs the prompt_id back. The high level
   * app.queuePrompt() (which returns a boolean and runs the whole frontend
   * command chain) is deliberately left untouched.
   */
  async submitPrompt({ prompt, workflow }) {
    const instance = resolveApiInstance();
    if (instance && typeof instance.queuePrompt === 'function') {
      const response = await instance.queuePrompt(0, { output: prompt, workflow }, undefined);
      return { promptId: (response && response.prompt_id) || null, response };
    }
    // Fallback for a frontend without the modern signature.
    const body = {
      client_id: (instance && instance.clientId) || 'rh-taskqueue',
      prompt,
      extra_data: { extra_pnginfo: { workflow } },
    };
    const result = await this._post(serverUrl('/prompt'), body);
    return { promptId: (result && result.prompt_id) || null, response: result };
  }
}
