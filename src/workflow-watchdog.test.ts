import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TURN_INACTIVITY_TIMEOUT_MS,
  TURN_MAX_RUNTIME_MS,
  observeTurnActivity,
  turnNeedsWatchdogIntervention,
} from './workflow-watchdog.ts'

test('new activity resets the inactivity timer', () => {
  const first = observeTurnActivity(undefined, 'turn-1', 'first', 1_000)
  const unchanged = observeTurnActivity(first, 'turn-1', 'first', 5_000)
  const changed = observeTurnActivity(unchanged, 'turn-1', 'second', 7_000)

  assert.equal(unchanged.lastActivityAt, 1_000)
  assert.equal(changed.lastActivityAt, 7_000)
})

test('intervenes after prolonged inactivity', () => {
  const observation = observeTurnActivity(undefined, 'turn-1', 'same', 1_000)
  const now = 1_000 + TURN_INACTIVITY_TIMEOUT_MS

  assert.equal(turnNeedsWatchdogIntervention(observation, 500, now), true)
})

test('enforces a maximum runtime even while activity changes', () => {
  const now = TURN_MAX_RUNTIME_MS + 10_000
  const observation = observeTurnActivity(undefined, 'turn-1', 'recent', now - 1_000)

  assert.equal(turnNeedsWatchdogIntervention(observation, 1, now), true)
})
