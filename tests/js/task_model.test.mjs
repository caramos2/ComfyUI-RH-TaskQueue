import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  liveQueueWaitSeconds,
  STATUS,
  applyTiming,
  computeTiming,
  formatDuration,
  fromJobsApi,
  liveExecutionSeconds,
  mergeRecord,
  resolveRunningStart,
} from '../../web/core/task_model.js'

test('backend pending job maps to BACKEND_PENDING', () => {
  const record = fromJobsApi({ id: 'p1', status: 'pending', create_time: 1700000000000 })
  assert.equal(record.status, STATUS.BACKEND_PENDING)
  assert.equal(record.id, 'p1')
})

test('in_progress maps to RUNNING and never fabricates a start time', () => {
  const record = fromJobsApi({ id: 'p2', status: 'in_progress', create_time: 1700000000000 })
  assert.equal(record.status, STATUS.RUNNING)
  assert.equal(record.executionStartedAt, null)
  assert.equal(record.executionSeconds, null)
})

test('completed job keeps backend authoritative times', () => {
  const record = fromJobsApi({
    id: 'p3',
    status: 'completed',
    create_time: 1700000000000,
    execution_start_time: 1700000001000,
    execution_end_time: 1700000009000,
    outputs_count: 3,
    previewable_outputs_count: 2,
  })
  assert.equal(record.status, STATUS.COMPLETED)
  assert.equal(record.executionSeconds, 8)
  assert.equal(record.outputsCount, 3)
  assert.equal(record.previewableOutputsCount, 2)
})

test('failed and cancelled keep their own status', () => {
  assert.equal(fromJobsApi({ id: 'p4', status: 'failed' }).status, STATUS.FAILED)
  assert.equal(fromJobsApi({ id: 'p5', status: 'cancelled' }).status, STATUS.CANCELLED)
})

test('merge prefers non-null newer fields', () => {
  const base = { id: 'p6', status: STATUS.RUNNING, executionStartedAt: null, outputsCount: 0 }
  const incoming = { id: 'p6', status: STATUS.COMPLETED, executionStartedAt: 111, outputsCount: 2 }
  const merged = mergeRecord(base, incoming)
  assert.equal(merged.status, STATUS.COMPLETED)
  assert.equal(merged.executionStartedAt, 111)
  assert.equal(merged.outputsCount, 2)
})

test('merge never resurrects a terminal task and never loses the notified flag', () => {
  const base = { id: 'p7', status: STATUS.COMPLETED, notified: true }
  const incoming = { id: 'p7', status: STATUS.RUNNING, notified: false }
  const merged = mergeRecord(base, incoming)
  assert.equal(merged.status, STATUS.COMPLETED)
  assert.equal(merged.notified, true)
})

test('merge keeps a known start time when the update has none', () => {
  const base = { id: 'p8', status: STATUS.RUNNING, executionStartedAt: 5000 }
  const merged = mergeRecord(base, { id: 'p8', status: STATUS.RUNNING, executionStartedAt: null })
  assert.equal(merged.executionStartedAt, 5000)
})

test('formatDuration renders mm:ss', () => {
  assert.equal(formatDuration(0), '00:00')
  assert.equal(formatDuration(65), '01:05')
  assert.equal(formatDuration(3600), '60:00')
  assert.equal(formatDuration(null), '--:--')
})

test('computeTiming separates queue wait from execution', () => {
  const timing = computeTiming({ submittedAt: 1000, executionStartedAt: 3000, executionEndedAt: 9000 })
  assert.equal(timing.queueWaitSeconds, 2)
  assert.equal(timing.executionSeconds, 6)
})

test('applyTiming leaves partial timing null', () => {
  const record = applyTiming({ submittedAt: 1000, executionStartedAt: 3000, executionEndedAt: null })
  assert.equal(record.queueWaitSeconds, 2)
  assert.equal(record.executionSeconds, null)
})

test('live execution seconds grows while running', () => {
  const record = { status: STATUS.RUNNING, executionStartedAt: 1000 }
  assert.equal(liveExecutionSeconds(record, 4000), 3)
  assert.equal(liveExecutionSeconds({ status: STATUS.COMPLETED }, 4000), null)
})

test('plugin queued tasks measure the wait from creation', () => {
  const record = { status: STATUS.PLUGIN_QUEUED, createdAt: 1000, submittedAt: null }
  assert.equal(liveQueueWaitSeconds(record, 4000), 3)
  assert.equal(liveQueueWaitSeconds({ status: STATUS.PLUGIN_QUEUED, createdAt: null }, 4000), null)
})

test('backend pending tasks measure the wait from submission', () => {
  const record = { status: STATUS.BACKEND_PENDING, createdAt: 500, submittedAt: 1000 }
  assert.equal(liveQueueWaitSeconds(record, 4000), 3)
})

test('a task first seen while running still gets a start moment', () => {
  const record = { id: 'p9', status: STATUS.RUNNING, executionStartedAt: null }
  resolveRunningStart(record, null, 4000)
  assert.equal(record.executionStartedAt, 4000)
  assert.equal(liveExecutionSeconds(record, 6500), 2.5)
})

test('the websocket start moment wins over the local fallback', () => {
  const record = { id: 'p10', status: STATUS.RUNNING, executionStartedAt: null }
  resolveRunningStart(record, 1200, 4000)
  assert.equal(record.executionStartedAt, 1200)
})

test('a known start moment is never overwritten', () => {
  const record = { id: 'p11', status: STATUS.RUNNING, executionStartedAt: 900 }
  resolveRunningStart(record, 1200, 4000)
  assert.equal(record.executionStartedAt, 900)
})

test('a task that is not running is left alone', () => {
  const record = { id: 'p12', status: STATUS.BACKEND_PENDING, executionStartedAt: null }
  resolveRunningStart(record, null, 4000)
  assert.equal(record.executionStartedAt, null)
})
