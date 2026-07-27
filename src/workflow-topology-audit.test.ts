import assert from 'node:assert/strict'
import { test } from 'node:test'
import { auditWorkflowTopology } from './workflow-topology-audit.ts'

const agents = [
  { id: 'ceo', name: 'CEO', assignment: 'management' as const },
  { id: 'research', name: 'Forschungsleiter', assignment: 'agent' as const },
]

test('accepts complete agent to status to target paths', () => {
  assert.deepEqual(auditWorkflowTopology({
    agents,
    activeAgentIds: new Set(['ceo']),
    statuses: [{ id: 'delegate' }],
    filters: [{ id: 'filter', ownerAgentId: 'ceo', statusId: 'delegate' }],
    routes: [
      { ownerAgentId: 'ceo', sourceId: 'ceo', targetId: 'filter' },
      { ownerAgentId: 'ceo', sourceId: 'filter', targetId: 'research' },
    ],
    terminals: [],
  }), [])
})

test('reports missing statuses and incomplete status connections without repairing them', () => {
  const issues = auditWorkflowTopology({
    agents,
    activeAgentIds: new Set(['ceo', 'research']),
    statuses: [{ id: 'delegate' }],
    filters: [{ id: 'filter', ownerAgentId: 'ceo', statusId: 'delegate' }],
    routes: [],
    terminals: [],
  })

  assert.deepEqual(issues.map((issue) => issue.code), [
    'unreachable-status',
    'missing-target',
    'missing-status',
  ])
})

test('reports routes whose endpoint no longer exists', () => {
  const issues = auditWorkflowTopology({
    agents,
    activeAgentIds: new Set(['ceo']),
    statuses: [{ id: 'delegate' }],
    filters: [{ id: 'filter', ownerAgentId: 'ceo', statusId: 'delegate' }],
    routes: [
      { ownerAgentId: 'ceo', sourceId: 'ceo', targetId: 'filter' },
      { ownerAgentId: 'ceo', sourceId: 'filter', targetId: 'removed-agent' },
    ],
    terminals: [],
  })

  assert.equal(issues.some((issue) => issue.code === 'dangling-route'), true)
})
