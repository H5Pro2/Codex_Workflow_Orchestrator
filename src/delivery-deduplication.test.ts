import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deliveryDeduplicationSignature,
  shouldDeliverWorkflowTask,
} from './delivery-deduplication.ts'

test('keeps normal workflow results protected by their task signature', () => {
  assert.equal(
    deliveryDeduplicationSignature('same task', 'turn-2', false),
    'same task',
  )
})

test('reports the same technical failure once for every completed turn', () => {
  assert.equal(
    deliveryDeduplicationSignature('interrupted', 'turn-2', true),
    'interrupted::turn:turn-2',
  )
  assert.notEqual(
    deliveryDeduplicationSignature('interrupted', 'turn-1', true),
    deliveryDeduplicationSignature('interrupted', 'turn-2', true),
  )
})

test('does not manufacture a signature without a task result', () => {
  assert.equal(deliveryDeduplicationSignature('', 'turn-2', true), '')
})

test('allows an explicitly resumed checkpoint through duplicate protection once', () => {
  assert.equal(shouldDeliverWorkflowTask({
    currentSignature: 'same task',
    lastForwardedSignature: 'same task',
  }), false)
  assert.equal(shouldDeliverWorkflowTask({
    currentSignature: 'same task',
    lastForwardedSignature: 'same task',
    replayCheckpoint: true,
  }), true)
})
