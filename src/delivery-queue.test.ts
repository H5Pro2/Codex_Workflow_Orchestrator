import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  dequeueDelivery,
  enqueueDelivery,
  normalizeDeliveryQueue,
  pruneDeliveryQueue,
  removeDeliveryAgent,
  removeDeliveryTarget,
} from './delivery-queue.ts'

test('serializes parallel deliveries per target without duplicates', () => {
  let queue = enqueueDelivery({}, 'qa', 'frontend')
  queue = enqueueDelivery(queue, 'qa', 'designer')
  queue = enqueueDelivery(queue, 'qa', 'frontend')
  assert.deepEqual(queue, { qa: ['frontend', 'designer'] })

  const first = dequeueDelivery(queue, 'qa')
  assert.equal(first.sourceId, 'frontend')
  assert.deepEqual(first.queue, { qa: ['designer'] })
  const second = dequeueDelivery(first.queue, 'qa')
  assert.equal(second.sourceId, 'designer')
  assert.deepEqual(second.queue, {})
})

test('normalizes a persisted queue after restart', () => {
  assert.deepEqual(normalizeDeliveryQueue({ qa: ['frontend', 'frontend', 'designer'], empty: [] }), {
    qa: ['frontend', 'designer'],
  })
})

test('removes failed or completed delivery targets', () => {
  assert.deepEqual(removeDeliveryTarget({ qa: ['frontend'], ceo: ['qa'] }, 'qa'), {
    ceo: ['qa'],
  })
})

test('removes a deleted agent as delivery target and source', () => {
  assert.deepEqual(removeDeliveryAgent({ deleted: ['ceo'], qa: ['deleted', 'frontend'] }, 'deleted'), {
    qa: ['frontend'],
  })
  assert.deepEqual(pruneDeliveryQueue({ missing: ['ceo'], qa: ['missing', 'frontend'] }, ['qa', 'frontend']), {
    qa: ['frontend'],
  })
})
