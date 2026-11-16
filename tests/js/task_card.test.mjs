/**
 * The timing line on a task card.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { timingText } from '../../web/ui/timing_text.js'
import { STATUS } from '../../web/core/task_model.js'

test('a running task shows the live elapsed time', () => {
  const record = { status: STATUS.RUNNING, executionStartedAt: 1000 }
  assert.equal(timingText(record, 6500), '已运行 00:05')
})

test('a backend pending task shows the queue wait', () => {
  const record = { status: STATUS.BACKEND_PENDING, submittedAt: 1000, queuePosition: 2 }
  assert.equal(timingText(record, 4000), '后端等待 00:03 · 队列位置 2')
})

test('a finished task shows its duration', () => {
  const record = { status: STATUS.COMPLETED, executionSeconds: 12 }
  assert.equal(timingText(record, 4000), '本次耗时 00:12')
})

test('a task that was cancelled before it ran shows no duration', () => {
  assert.equal(timingText({ status: STATUS.CANCELLED, executionSeconds: null }, 4000), '已中止')
  assert.equal(
    timingText({ status: STATUS.CANCELLED, executionSeconds: 3 }, 4000),
    '已中止 · 耗时 00:03'
  )
})

test('a failed task shows no duration when it never ran', () => {
  assert.equal(timingText({ status: STATUS.FAILED, executionSeconds: null }, 4000), '执行失败')
  assert.equal(
    timingText({ status: STATUS.FAILED, executionSeconds: 7 }, 4000),
    '执行失败 · 耗时 00:07'
  )
})
