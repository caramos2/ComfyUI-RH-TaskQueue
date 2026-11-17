/**
 * Websocket bridge.
 *
 * The websocket is the fastest way to learn that a task started or finished,
 * but events can be missed (a reconnect, a dropped connection) and they do
 * not carry every field we need. So events only ever *hint* at a state
 * change; the authoritative answer always comes from the Jobs API.
 *
 * Note: the execution_start event carries the server's own timestamp
 * (ComfyUI stamps every status message with the wall clock), so the start
 * moment is taken from the server when it is there and stamped locally
 * otherwise. The authoritative times replace it once the job reaches a
 * terminal state.
 */

import { resolveApiInstance } from './api_client.js';

const START_EVENT = 'execution_start';
const TERMINAL_EVENTS = ['execution_success', 'execution_error', 'execution_interrupted'];
// The frontend reports a null status when the connection to the backend is
// gone. That is the signal the queue needs to give its leader lease back.
const STATUS_EVENT = 'status';

export class EventBridge {
  constructor({ onEvent, onStatus }) {
    this.onEvent = onEvent || (() => {});
    this.onStatus = onStatus || (() => {});
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
        if (type === STATUS_EVENT) this.onStatus(detail);
        else this.onEvent(type, detail);
      };
      this.instance.addEventListener(type, handler);
      this.handlers.push({ type, handler });
    };
    bind(START_EVENT);
    for (const type of TERMINAL_EVENTS) bind(type);
    bind(STATUS_EVENT);
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
