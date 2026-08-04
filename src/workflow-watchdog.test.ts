import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  TURN_INACTIVITY_TIMEOUT_MS,
  TURN_MAX_RUNTIME_MS,
  observeTurnActivity,
  turnNeedsWatchdogIntervention,
  turnNeedsZombieIntervention,
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

test('does not warn for a turn that showed activity less than five minutes ago', () => {
  const now = Date.now()
  const observation = observeTurnActivity(undefined, 'turn-1', 'recent', now - 1_000)

  assert.equal(
    turnNeedsWatchdogIntervention(observation, now - 30 * 60 * 1000, now),
    false,
  )
})

test('allows a long-running turn while it still shows activity', () => {
  const now = 60 * 60 * 1000
  const observation = observeTurnActivity(undefined, 'turn-1', 'recent', now - 1_000)

  assert.equal(turnNeedsWatchdogIntervention(observation, 1, now), false)
})

test('marks a max-runtime turn without visible activity as zombie', () => {
  const now = TURN_MAX_RUNTIME_MS + 1_000
  const observation = observeTurnActivity(undefined, 'turn-1', '', now)

  assert.equal(turnNeedsZombieIntervention(observation, 1, now), true)
})

test('marks a max-runtime turn as zombie even while activity is visible', () => {
  const now = TURN_MAX_RUNTIME_MS + 1_000
  const observation = observeTurnActivity(undefined, 'turn-1', 'working', now - 1_000)

  assert.equal(turnNeedsZombieIntervention(observation, 1, now), true)
})
