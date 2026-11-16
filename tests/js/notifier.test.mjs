/**
 * The completion chime.
 *
 * Several tasks often finish within the same second, so the chimes must
 * merge into one instead of stacking on top of each other.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CHIME_MERGE_WINDOW_MS,
  ChimeGate,
  Notifier,
} from '../../web/core/notifier.js'

function fakeSettings(values = {}) {
  const store = Object.assign(
    { soundEnabled: true, soundVolume: 0.3, notifyOnFailure: true },
    values
  )
  return { get: (key) => store[key] }
}

class FakeParam {
  constructor() {
    this.value = 0
  }
  setValueAtTime() {}
  exponentialRampToValueAtTime() {}
}

class FakeContext {
  constructor() {
    this.currentTime = 0
    this.state = 'running'
    this.destination = { name: 'destination' }
    this.oscillators = 0
    this.gains = 0
    this.limiters = 0
  }
  createGain() {
    this.gains += 1
    return { gain: new FakeParam(), connect() {} }
  }
  createOscillator() {
    this.oscillators += 1
    return {
      type: '',
      frequency: new FakeParam(),
      connect() {},
      start() {},
      stop() {},
    }
  }
  createDynamicsCompressor() {
    this.limiters += 1
    return {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
      connect() {},
    }
  }
  resume() {
    return Promise.resolve()
  }
}

/** Run a piece of code with a fake browser AudioContext in place. */
function withAudio(fn) {
  const saved = globalThis.window
  const context = new FakeContext()
  globalThis.window = {
    AudioContext: function AudioContext() {
      return context
    },
  }
  try {
    return fn(context)
  } finally {
    if (saved === undefined) delete globalThis.window
    else globalThis.window = saved
  }
}

test('the first chime sounds', () => {
  withAudio((context) => {
    const notifier = new Notifier(fakeSettings())
    assert.equal(notifier.playChime(), true)
    assert.equal(context.oscillators, 2)
  })
})

test('chimes that follow inside the window are merged into one', () => {
  withAudio((context) => {
    const notifier = new Notifier(fakeSettings())
    assert.equal(notifier.playChime(), true)
    assert.equal(notifier.playChime(), false)
    assert.equal(notifier.playChime(), false)
    assert.equal(notifier.playChime(), false)
    // one chime only: two oscillators instead of eight
    assert.equal(context.oscillators, 2)
    assert.equal(notifier.chimeGate.mergedCount, 3)
  })
})

test('a burst of finished tasks produces a single chime', () => {
  withAudio((context) => {
    const notifier = new Notifier(fakeSettings())
    for (let index = 0; index < 5; index += 1) {
      const record = { id: 'task-' + index }
      notifier.announceSuccess(record, { durationText: '00:01', outputCount: 1 })
    }
    assert.equal(context.oscillators, 2)
  })
})

test('the gate lets a chime through again after the window', () => {
  const gate = new ChimeGate(1000)
  assert.equal(gate.request(1000), true)
  assert.equal(gate.request(1500), false)
  assert.equal(gate.request(2100), true)
  assert.equal(gate.mergedCount, 0)
})

test('the merge window is longer than the chime itself', () => {
  assert.ok(CHIME_MERGE_WINDOW_MS >= 500)
})

test('the test button always sounds', () => {
  withAudio((context) => {
    const notifier = new Notifier(fakeSettings())
    assert.equal(notifier.playChime(), true)
    assert.equal(notifier.playChime({ force: true }), true)
    assert.equal(context.oscillators, 4)
  })
})

test('nothing sounds when the sound is switched off', () => {
  withAudio((context) => {
    const notifier = new Notifier(fakeSettings({ soundEnabled: false }))
    assert.equal(notifier.playChime(), false)
    assert.equal(context.oscillators, 0)
  })
})

test('every chime runs through one shared limiter', () => {
  withAudio((context) => {
    const notifier = new Notifier(fakeSettings())
    notifier.playChime()
    notifier.playChime({ force: true })
    assert.equal(context.limiters, 1)
  })
})
