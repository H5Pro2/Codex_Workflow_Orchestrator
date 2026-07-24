import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isDeliveryTargetBusy } from './delivery-availability.ts'

test('uses the current agent state instead of a stale delivery snapshot', () => {
  assert.equal(isDeliveryTargetBusy({
    targetId: 'quality',
    activeTargetIds: new Set(),
    agents: [{ id: 'quality', status: 'fertig', pendingTurnId: '' }],
  }), false)
})

test('blocks active targets and targets with a pending turn', () => {
  assert.equal(isDeliveryTargetBusy({
    targetId: 'quality',
    activeTargetIds: new Set(['quality']),
    agents: [{ id: 'quality', status: 'fertig', pendingTurnId: '' }],
  }), true)
  assert.equal(isDeliveryTargetBusy({
    targetId: 'quality',
    activeTargetIds: new Set(),
    agents: [{ id: 'quality', status: 'wartet', pendingTurnId: 'turn-1' }],
  }), true)
})
