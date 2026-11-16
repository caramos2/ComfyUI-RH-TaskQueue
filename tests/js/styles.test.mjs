/**
 * Regression guard for the drawer being invisible to real mouse clicks.
 *
 * The drawer host sets `pointer-events: none` inline so the 100%-wide,
 * zero-height overlay never blocks ComfyUI's own UI. `pointer-events` is an
 * inherited property, so every descendant inherits `none` and the drawer
 * becomes transparent to real clicks (elementFromPoint lands on the canvas).
 * The interactive parts must opt back in explicitly.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { CSS } from '../../web/ui/styles.js';

function ruleBody(css, selector) {
  const needle = selector + ' {';
  const index = css.indexOf(needle);
  assert.notEqual(index, -1, 'missing CSS rule: ' + selector);
  const open = css.indexOf('{', index);
  const close = css.indexOf('}', open);
  assert.notEqual(close, -1, 'unterminated CSS rule: ' + selector);
  // Strip comments so assertions only look at real declarations.
  return css.slice(open + 1, close).replace(/\/\*[\s\S]*?\*\//g, '');
}

test('the task queue tab opts back into pointer events', () => {
  const body = ruleBody(CSS, '.rh-tq-tab');
  assert.match(body, /pointer-events:\s*auto/, 'tab must be clickable');
  assert.doesNotMatch(body, /pointer-events:\s*none/);
});

test('the closed drawer is inert and the open drawer accepts pointer events', () => {
  assert.match(ruleBody(CSS, '.rh-tq-panel'), /pointer-events:\s*none/);
  assert.match(ruleBody(CSS, '.rh-tq-panel.is-open'), /pointer-events:\s*auto/);
});

test('the host keeps pointer-events off so it cannot block ComfyUI', () => {
  // The host style lives in drawer.js as an inline style; :host must not
  // re-enable pointer events for the whole subtree either.
  const host = ruleBody(CSS, ':host');
  assert.doesNotMatch(host, /pointer-events:\s*auto/);
});
