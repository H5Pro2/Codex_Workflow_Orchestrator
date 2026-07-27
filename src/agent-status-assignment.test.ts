import assert from 'node:assert/strict'
import { test } from 'node:test'
import { explicitAgentStatusIds } from './agent-status-assignment.ts'

const filters = [
  { id: 'connected', ownerAgentId: 'ceo', statusId: 'start' },
  { id: 'stale', ownerAgentId: 'ceo', statusId: 'unused' },
  { id: 'other', ownerAgentId: 'research', statusId: 'specialist' },
]
const routes = [
  { ownerAgentId: 'ceo', sourceId: 'ceo', targetId: 'connected' },
  { ownerAgentId: 'ceo', sourceId: 'connected', targetId: 'architect' },
  { ownerAgentId: 'research', sourceId: 'research', targetId: 'other' },
  { ownerAgentId: 'research', sourceId: 'other', targetId: 'specialist' },
]

test('merges explicit statuses with statuses present in the agent dashboard', () => {
  assert.deepEqual(explicitAgentStatusIds(['review', 'review'], 'ceo', filters, routes), ['review', 'start', 'unused'])
  assert.deepEqual(explicitAgentStatusIds([], 'ceo', filters, routes), ['start', 'unused'])
})

test('migrates a legacy agent from all status filters in its dashboard', () => {
  assert.deepEqual(explicitAgentStatusIds(null, 'ceo', filters, routes), ['start', 'unused'])
  assert.deepEqual(explicitAgentStatusIds(undefined, 'research', filters, routes), ['specialist'])
  assert.deepEqual(explicitAgentStatusIds(null, 'unconnected', filters, routes), [])
})
