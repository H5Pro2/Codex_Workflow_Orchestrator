import assert from 'node:assert/strict'
import test from 'node:test'
import { confirmInactiveTurn } from './turn-inactivity.mjs'

test('requires continuous inactivity before declaring a turn missing', () => {
  const observations = new Map()
  const input = { observations, key: 'thread:turn', inactive: true, confirmationMs: 20_000 }

  assert.equal(confirmInactiveTurn({ ...input, now: 1_000 }), false)
  assert.equal(confirmInactiveTurn({ ...input, now: 20_999 }), false)
  assert.equal(confirmInactiveTurn({ ...input, now: 21_000 }), true)
})

test('active thread inventory resets the inactivity confirmation', () => {
  const observations = new Map()
  const base = { observations, key: 'thread:turn', confirmationMs: 20_000 }

  assert.equal(confirmInactiveTurn({ ...base, inactive: true, now: 1_000 }), false)
  assert.equal(confirmInactiveTurn({ ...base, inactive: false, now: 15_000 }), false)
  assert.equal(confirmInactiveTurn({ ...base, inactive: true, now: 25_000 }), false)
  assert.equal(confirmInactiveTurn({ ...base, inactive: true, now: 45_000 }), true)
})
