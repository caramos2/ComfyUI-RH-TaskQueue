/**
 * The plugin's own queue and the leader lease that keeps one tab in charge.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QueueManager } from '../../web/core/queue_manager.js'

const LEADER_KEY = 'rh_taskqueue_leader'

function fakeStorage() {
  const map = new Map()
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  }
}

function withBrowser(fn) {
  const savedWindow = globalThis.window
  const savedChannel = globalThis.BroadcastChannel
  const storage = fakeStorage()
  globalThis.window = { localStorage: storage, addEventListener() {}, removeEventListener() {} }
  // Node has a BroadcastChannel too; it would keep the test runner alive.
  globalThis.BroadcastChannel = undefined
  try {
    return fn(storage)
  } finally {
    if (savedWindow === undefined) delete globalThis.window
    else globalThis.window = savedWindow
    if (savedChannel === undefined) delete globalThis.BroadcastChannel
    else globalThis.BroadcastChannel = savedChannel
  }
}

function makeQueue() {
  const queue = new QueueManager({
    settings: { get: () => false },
    taskStore: { listLocal: async () => [] },
    onChange() {},
  })
  queue.tabId = 'tab-under-test'
  return queue
}

test('a tab that lost the backend gives the leader lease back', () => {
  withBrowser((storage) => {
    const queue = makeQueue()
    queue._claimLeadership()
    assert.ok(storage.getItem(LEADER_KEY))
    queue.setConnected(false)
    assert.equal(storage.getItem(LEADER_KEY), null)
  })
})

test('a disconnected tab does not take the lease over', () => {
  withBrowser((storage) => {
    const queue = makeQueue()
    queue.setConnected(false)
    queue._heartbeat()
    assert.equal(storage.getItem(LEADER_KEY), null)
  })
})

test('a tab only ever releases its own lease', () => {
  withBrowser((storage) => {
    storage.setItem(LEADER_KEY, JSON.stringify({ id: 'another-tab', ts: Date.now() }))
    const queue = makeQueue()
    queue.setConnected(false)
    assert.ok(storage.getItem(LEADER_KEY), 'the other tab keeps the lease')
  })
})

test('the leader picks up a task that another tab queued', async () => {
  await withBrowser(async (storage) => {
    const shared = [
      {
        id: 'local-from-other-tab',
        status: 'plugin_queued',
        origin: 'plugin',
        createdAt: 1,
        snapshot: { prompt: { '1': { class_type: 'String Literal' } } },
      },
    ];
    const store = {
      listLocal: async () => shared,
      deleteLocal: async () => true,
    };
    const queue = new QueueManager({
      settings: { get: () => false },
      taskStore: store,
      onChange() {},
    })
    queue.tabId = 'tab-leader'
    queue._claimLeadership()
    assert.equal(queue.records.size, 0)
    await queue.mergeFromStore()
    const picked = queue.records.get('local-from-other-tab')
    assert.ok(picked, 'the task of the other tab is known now')
    assert.equal(picked.snapshot.prompt['1'].class_type, 'String Literal')
  })
})

test('a connected tab keeps the lease alive', () => {
  withBrowser((storage) => {
    const queue = makeQueue()
    queue._claimLeadership()
    queue._heartbeat()
    assert.ok(storage.getItem(LEADER_KEY))
  })
})
