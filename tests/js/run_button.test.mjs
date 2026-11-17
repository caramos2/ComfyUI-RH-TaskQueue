/**
 * The plugin's own run button and the frozen snapshot it works with.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freezeSnapshot } from '../../web/core/snapshot.js'
import {
  runButtonTooltipBody,
  runButtonTooltipTitle,
} from '../../web/ui/run_button.js'

test('the frozen snapshot shares nothing with the live canvas', () => {
  const live = {
    '1': { class_type: 'KSampler', inputs: { steps: 20, seed: 1, model: ['2', 0] } },
    '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt: 'sd.safetensors' } },
  }
  const frozen = freezeSnapshot(live)
  assert.deepEqual(frozen, live)
  live['1'].inputs.steps = 30
  live['1'].inputs.seed = 99
  live['2'].inputs.ckpt = 'other.safetensors'
  assert.equal(frozen['1'].inputs.steps, 20)
  assert.equal(frozen['1'].inputs.seed, 1)
  assert.equal(frozen['2'].inputs.ckpt, 'sd.safetensors')
})

test('freezing keeps the shape and passes empty values through', () => {
  assert.equal(freezeSnapshot(null), null)
  assert.equal(freezeSnapshot(undefined), undefined)
  const list = freezeSnapshot([{ a: 1 }])
  assert.equal(list[0].a, 1)
  assert.equal(Array.isArray(list), true)
})

test('the tooltip explains what the button does', () => {
  const title = runButtonTooltipTitle()
  const body = runButtonTooltipBody()
  assert.ok(title.length > 0)
  assert.ok(body.includes('冻结'), 'the tooltip says the parameters are frozen')
  assert.ok(body.includes('队列'), 'the tooltip says the task goes into the queue')
  assert.ok(body.includes('画布'), 'the tooltip says later edits do not matter')
})
