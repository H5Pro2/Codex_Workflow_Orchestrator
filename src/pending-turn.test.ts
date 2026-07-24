import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  hasStableTerminalResult,
  resolvePendingTurnStartedAt,
  shouldPollPendingTurn,
} from './pending-turn.ts'

test('polls a pending turn independently of the visible agent status', () => {
  assert.equal(shouldPollPendingTurn({
    threadId: 'thread',
    pendingTurnId: 'turn-2',
    lastCompletedTurnId: 'turn-1',
    isAlreadyPolling: false,
  }), true)
})

test('does not poll missing, completed, or currently polled turns', () => {
  const base = {
    threadId: 'thread',
    pendingTurnId: 'turn-2',
    lastCompletedTurnId: 'turn-1',
    isAlreadyPolling: false,
  }

  assert.equal(shouldPollPendingTurn({ ...base, pendingTurnId: '' }), false)
  assert.equal(shouldPollPendingTurn({ ...base, lastCompletedTurnId: 'turn-2' }), false)
  assert.equal(shouldPollPendingTurn({ ...base, isAlreadyPolling: true }), false)
})

test('accepts a repeatedly observed terminal result without a persisted start time', () => {
  assert.equal(hasStableTerminalResult({
    runStartedAt: '',
    observations: 2,
    now: Date.now(),
  }), true)
})

test('waits for both terminal confirmation and the normal startup grace period', () => {
  const now = Date.now()

  assert.equal(hasStableTerminalResult({
    runStartedAt: new Date(now - 10_000).toISOString(),
    observations: 1,
    now,
  }), false)
  assert.equal(hasStableTerminalResult({
    runStartedAt: new Date(now - 2_000).toISOString(),
    observations: 2,
    now,
  }), false)
  assert.equal(hasStableTerminalResult({
    runStartedAt: new Date(now - 10_000).toISOString(),
    observations: 2,
    now,
  }), true)
})

test('falls back to the persisted agent update time when the run start is missing', () => {
  const updatedAt = '2026-07-24T00:18:12.667Z'

  assert.equal(
    resolvePendingTurnStartedAt('', updatedAt),
    new Date(updatedAt).getTime(),
  )
})

test('prefers the explicit run start and rejects invalid timestamps', () => {
  const startedAt = '2026-07-24T00:20:00.000Z'

  assert.equal(
    resolvePendingTurnStartedAt(startedAt, '2026-07-24T00:18:12.667Z'),
    new Date(startedAt).getTime(),
  )
  assert.equal(resolvePendingTurnStartedAt('', 'invalid'), 0)
})
