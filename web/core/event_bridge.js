/**
 * Websocket bridge.
 *
 * The websocket is the fastest way to learn that a task started or finished,
 * but events can be missed (a reconnect, a dropped connection) and they do
 * not carry every field we need. So events only ever *hint* at a state
 * change; the authoritative answer always comes from the Jobs API.
 *
 * Note: the execution_start event carries only { prompt_id } - no timestamp -
 * so the start moment is stamped locally when the event arrives. The error is
 * under a second, and the authoritative times replace it once the job
 * reaches a terminal state.
 */

import { resolveApiInstance } from './api_client.js';

const START_EVENT = 'execution_start';
const TERMINAL_EVENTS = ['execution_success', 'execution_error', 'execution_interrupted'];

export class EventBridge {
  constructor({ onEvent }) {
    this.onEvent = onEvent || (() => {});
    this.instance = null;
    this.handlers = [];
  }

  start() {
    this.instance = resolveApiInstance();
    if (!this.instance || typeof this.instance.addEventListener !== 'function') {
      return false;
    }
    const bind = (type) => {
      const handler = (event) => {
        const detail = event && event.detail !== undefined ? event.detail : event;
        this.onEvent(type, detail);
      };
      this.instance.addEventListener(type, handler);
      this.handlers.push({ type, handler });
    };
    bind(START_EVENT);
    for (const type of TERMINAL_EVENTS) bind(type);
    return true;
  }

  stop() {
    if (this.instance && typeof this.instance.removeEventListener === 'function') {
      for (const { type, handler } of this.handlers) {
        try {
          this.instance.removeEventListener(type, handler);
        } catch (err) {
          /* ignore */
        }
      }
    }
    this.handlers = [];
  }
}

export { START_EVENT, TERMINAL_EVENTS };
