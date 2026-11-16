/**
 * End to end check of the fingerprint -> duration store chain.
 *
 * Run with the ComfyUI server on 127.0.0.1:8188:
 *   node tests/verify/verify_duration.mjs
 */

import assert from 'node:assert/strict';
import { computeSignature } from '../../web/core/fingerprint.js';

const BASE = process.env.RH_QUEUE_BASE || 'http://127.0.0.1:8188';

// Unique per run: the backend keys idempotency on prompt_id, so reusing a
// fixed id would make a second run collide with the first one.
const RUN_ID = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
const SELFTEST_PROMPT_A = 'selftest-a-' + RUN_ID;
const SELFTEST_PROMPT_B = 'selftest-b-' + RUN_ID;

function buildPrompt(text) {
  return {
    '1': { class_type: 'String Literal', inputs: { string: text } },
    '2': {
      class_type: 'SaveText',
      inputs: { text: ['1', 0], filename_prefix: 'rh_taskqueue_selftest', format: 'txt' },
    },
  };
}

async function post(path, body) {
  const response = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(path + ' -> HTTP ' + response.status);
  return response.json();
}

async function get(path) {
  const response = await fetch(BASE + path);
  if (!response.ok) throw new Error(path + ' -> HTTP ' + response.status);
  return response.json();
}

async function del(path) {
  const response = await fetch(BASE + path, { method: 'DELETE' });
  if (!response.ok) throw new Error(path + ' -> HTTP ' + response.status);
  return response.json();
}

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push('PASS  ' + name);
  } catch (err) {
    results.push('FAIL  ' + name + ' -> ' + err.message);
    process.exitCode = 1;
  }
}

const promptA = buildPrompt('rh-queue-selftest-v1');
const promptASame = buildPrompt('rh-queue-selftest-v1');
const promptB = buildPrompt('rh-queue-selftest-v2');

const sigA = computeSignature(promptA).signature;
const sigASame = computeSignature(promptASame).signature;
const sigB = computeSignature(promptB).signature;

check('same prompt yields the same signature', () => {
  assert.equal(sigA, sigASame);
});

check('different text yields a different signature', () => {
  assert.notEqual(sigA, sigB);
});

check('signature is 64 lowercase hex characters', () => {
  assert.match(sigA, /^[0-9a-f]{64}$/);
});

// Clean slate for this signature so the sample counts are predictable.
await del('/rh_queue/history/' + sigA);

const first = await post('/rh_queue/record', {
  signature: sigA,
  signature_version: 1,
  duration: 12.5,
  prompt_id: SELFTEST_PROMPT_A,
});
check('first record stores the duration', () => {
  assert.equal(first.ok, true);
  assert.equal(first.last_duration, 12.5);
  assert.equal(first.sample_count, 1);
  assert.equal(first.avg_duration, 12.5);
});

const second = await post('/rh_queue/record', {
  signature: sigA,
  signature_version: 1,
  duration: 20.0,
  prompt_id: SELFTEST_PROMPT_B,
});
check('second record updates count and average', () => {
  assert.equal(second.sample_count, 2);
  assert.equal(second.last_duration, 20.0);
  assert.equal(second.avg_duration, 16.25);
});

const estimate = await post('/rh_queue/estimate', {
  signature: sigA,
  signature_version: 1,
});
check('estimate returns the stored sample', () => {
  assert.equal(estimate.found, true);
  assert.equal(estimate.sample_count, 2);
  assert.equal(estimate.last_duration, 20.0);
  assert.equal(estimate.avg_duration, 16.25);
});

const miss = await post('/rh_queue/estimate', {
  signature: sigB,
  signature_version: 1,
});
check('a different workflow has no reference duration', () => {
  assert.equal(miss.found, false);
  assert.equal(miss.sample_count, 0);
});

const history = await get('/rh_queue/history?limit=10');
check('history lists the stored sample', () => {
  assert.ok(history.total >= 1);
  assert.ok(history.records.some((record) => record.signature === sigA));
});

const removed = await del('/rh_queue/history/' + sigA);
check('delete removes the sample', () => {
  assert.equal(removed.ok, true);
  assert.equal(removed.deleted, true);
});

const afterDelete = await post('/rh_queue/estimate', {
  signature: sigA,
  signature_version: 1,
});
check('estimate misses after deletion', () => {
  assert.equal(afterDelete.found, false);
});

const bad = await fetch(BASE + '/rh_queue/estimate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ signature: 'not-a-signature' }),
});
check('an invalid signature is rejected', () => {
  assert.equal(bad.status, 400);
});

console.log(results.join('\n'));
console.log('\n' + results.filter((line) => line.startsWith('PASS')).length + ' passed, ' +
  results.filter((line) => line.startsWith('FAIL')).length + ' failed');
