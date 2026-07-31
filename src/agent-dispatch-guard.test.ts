import assert from 'node:assert/strict'
import test from 'node:test'
import { releaseAgentDispatch, reserveAgentDispatch } from './agent-dispatch-guard.ts'

const idleAgent = {
  id: 'ceo',
  status: 'wartet',
  pendingTurnId: '',
}

test('reserves an idle agent synchronously before state persistence', () => {
  const activeAgentIds = new Set<string>()

  assert.equal(reserveAgentDispatch(activeAgentIds, idleAgent), true)
  assert.equal(reserveAgentDispatch(activeAgentIds, idleAgent), false)
})

test('rejects agents that already have a running or pending turn', () => {
  assert.equal(reserveAgentDispatch(new Set(), { ...idleAgent, status: 'laeuft' }), false)
  assert.equal(reserveAgentDispatch(new Set(), { ...idleAgent, pendingTurnId: 'turn-1' }), false)
  assert.equal(reserveAgentDispatch(new Set(), {
    ...idleAgent,
    pendingUserConfirmation: { confirmationText: 'BESTÄTIGT' },
  }), false)
})

test('allows a new dispatch only after the previous reservation is released', () => {
  const activeAgentIds = new Set<string>()

  assert.equal(reserveAgentDispatch(activeAgentIds, idleAgent), true)
  releaseAgentDispatch(activeAgentIds, idleAgent.id)
  assert.equal(reserveAgentDispatch(activeAgentIds, idleAgent), true)
})
