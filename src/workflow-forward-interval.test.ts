import assert from 'node:assert/strict'
import test from 'node:test'
import {
  nextForwardIntervalHit,
  normalizeForwardInterval,
  normalizeForwardIntervalCount,
} from './workflow-forward-interval.ts'

test('uses the normal branch until the configured interval is reached', () => {
  assert.deepEqual(nextForwardIntervalHit(5, 0), { branch: 'normal', nextCount: 1 })
  assert.deepEqual(nextForwardIntervalHit(5, 3), { branch: 'normal', nextCount: 4 })
  assert.deepEqual(nextForwardIntervalHit(5, 4), { branch: 'interval', nextCount: 0 })
})

test('disables interval counting for an empty or zero value', () => {
  assert.deepEqual(nextForwardIntervalHit(0, 8), { branch: 'normal', nextCount: 0 })
  assert.equal(normalizeForwardInterval(''), 0)
  assert.equal(normalizeForwardIntervalCount(8, 0), 0)
})

test('normalizes persisted interval values to stable bounds', () => {
  assert.equal(normalizeForwardInterval(1_500), 999)
  assert.equal(normalizeForwardInterval(-4), 0)
  assert.equal(normalizeForwardIntervalCount(12, 5), 4)
})
