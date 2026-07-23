import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveDeterministicCommunicationRepairTarget } from './communication-repair.ts'

test('repairs a missing route only when status and target are unambiguous', () => {
  assert.equal(resolveDeterministicCommunicationRepairTarget({
    sourceAgentId: 'ceo',
    activeRouteCount: 0,
    resultStatusIds: ['forward'],
    dashboardAgentIds: ['ceo', 'implementation'],
    knownAgentIds: ['ceo', 'implementation'],
  }), 'implementation')
})

test('rejects ambiguous or already configured communication paths', () => {
  const base = {
    sourceAgentId: 'ceo',
    activeRouteCount: 0,
    resultStatusIds: ['forward'],
    dashboardAgentIds: ['ceo', 'implementation'],
    knownAgentIds: ['ceo', 'implementation', 'qa'],
  }

  assert.equal(resolveDeterministicCommunicationRepairTarget({
    ...base,
    dashboardAgentIds: ['ceo', 'implementation', 'qa'],
  }), '')
  assert.equal(resolveDeterministicCommunicationRepairTarget({
    ...base,
    resultStatusIds: ['forward', 'review'],
  }), '')
  assert.equal(resolveDeterministicCommunicationRepairTarget({
    ...base,
    activeRouteCount: 1,
  }), '')
})

