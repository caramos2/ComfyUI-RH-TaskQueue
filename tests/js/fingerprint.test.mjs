import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canonicalJson,
  computeSignature,
  normalizePrompt,
  sha256Hex,
} from '../../web/core/fingerprint.js'

test('canonical json sorts keys recursively', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}')
})

test('canonical json keeps array order', () => {
  assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]')
})

test('seed and noise_seed are removed recursively', () => {
  const normalized = normalizePrompt({
    '1': { inputs: { seed: 42, noise_seed: 7, steps: 20 } },
    '2': { inputs: { seed: 9 } },
  })
  assert.equal(normalized['1'].inputs.seed, undefined)
  assert.equal(normalized['1'].inputs.noise_seed, undefined)
  assert.equal(normalized['2'].inputs.seed, undefined)
  assert.equal(normalized['1'].inputs.steps, 20)
})

test('normalize does not mutate the source prompt', () => {
  const source = { '1': { inputs: { seed: 1 } } }
  normalizePrompt(source)
  assert.equal(source['1'].inputs.seed, 1)
})

test('sha256 matches known vectors', () => {
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
})

test('sha256 handles non ascii', () => {
  assert.equal(sha256Hex('中文'), sha256Hex('中文'))
  assert.equal(sha256Hex('中文').length, 64)
})

test('signature is stable across key order', () => {
  const a = computeSignature({ '1': { class_type: 'KSampler', inputs: { seed: 1, steps: 20 } } })
  const b = computeSignature({ '1': { inputs: { steps: 20, seed: 1 }, class_type: 'KSampler' } })
  assert.equal(a.signature, b.signature)
  assert.equal(a.signature_version, 1)
})

test('signature ignores seed but reacts to steps', () => {
  const a = computeSignature({ '1': { class_type: 'KSampler', inputs: { steps: 20, seed: 1 } } })
  const b = computeSignature({ '1': { class_type: 'KSampler', inputs: { steps: 20, seed: 999 } } })
  const c = computeSignature({ '1': { class_type: 'KSampler', inputs: { steps: 30, seed: 1 } } })
  assert.equal(a.signature, b.signature)
  assert.notEqual(a.signature, c.signature)
})
