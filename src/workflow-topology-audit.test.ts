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

test('reports incomplete status connections without requiring every agent to have an outgoing path', () => {
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
  ])
  assert.equal(
    issues.some((issue) => issue.detail.includes('kein ausgehender Workflow-Pfad')),
    false,
  )
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

test('requires both outputs for an enabled forwarding interval', () => {
  const issues = auditWorkflowTopology({
    agents,
    activeAgentIds: new Set(['ceo']),
    statuses: [{ id: 'delegate' }],
    filters: [{ id: 'filter', ownerAgentId: 'ceo', statusId: 'delegate' }],
    routes: [
      { ownerAgentId: 'ceo', sourceId: 'ceo', targetId: 'filter' },
      { ownerAgentId: 'ceo', sourceId: 'filter', targetId: 'forward-node' },
      { ownerAgentId: 'ceo', sourceId: 'forward-node', sourceHandle: 'output', targetId: 'research' },
    ],
    terminals: [{ id: 'forward-node', ownerAgentId: 'ceo' }],
    forwardingNodes: [{ id: 'forward-node', ownerAgentId: 'ceo', interval: 5 }],
  })

  assert.equal(issues.some((issue) => issue.detail.includes('keinen Intervall-Ausgang')), true)
  assert.equal(issues.some((issue) => issue.detail.includes('keinen normalen Ausgang')), false)
})

test('accepts a direct forwarding node without a fachlicher status', () => {
  assert.deepEqual(auditWorkflowTopology({
    agents,
    activeAgentIds: new Set(['research']),
    statuses: [{ id: 'delegate' }],
    filters: [],
    routes: [
      { ownerAgentId: 'research', sourceId: 'research', targetId: 'forward-node' },
      { ownerAgentId: 'research', sourceId: 'forward-node', targetId: 'ceo' },
    ],
    terminals: [],
    forwardingNodes: [{ id: 'forward-node', ownerAgentId: 'research' }],
  }), [])
})

test('accepts a project dashboard forwarding path even when the forwarding node owner differs', () => {
  assert.deepEqual(auditWorkflowTopology({
    agents,
    activeAgentIds: new Set(['research']),
    statuses: [{ id: 'delegate' }],
    filters: [],
    routes: [
      { ownerAgentId: 'research', sourceId: 'research', targetId: 'forward-node' },
      { ownerAgentId: 'research', sourceId: 'forward-node', targetId: 'ceo' },
    ],
    terminals: [],
    forwardingNodes: [{ id: 'forward-node', ownerAgentId: 'ceo' }],
  }), [])
})

test('accepts a loop node with a configured target agent', () => {
  assert.deepEqual(auditWorkflowTopology({
    agents,
    activeAgentIds: new Set(['research']),
    statuses: [{ id: 'delegate' }],
    filters: [],
    routes: [
      { ownerAgentId: 'research', sourceId: 'research', targetId: 'return-loop' },
    ],
    terminals: [],
    loopNodes: [{ id: 'return-loop', ownerAgentId: 'research', targetAgentId: 'ceo' }],
  }), [])
})

test('accepts a loop node with multiple configured target agents', () => {
  assert.deepEqual(auditWorkflowTopology({
    agents,
    activeAgentIds: new Set(['research']),
    statuses: [{ id: 'delegate' }],
    filters: [],
    routes: [
      { ownerAgentId: 'research', sourceId: 'research', targetId: 'return-loop' },
    ],
    terminals: [],
    loopNodes: [{
      id: 'return-loop',
      ownerAgentId: 'research',
      targetAgentId: 'ceo',
      targetAgentIds: ['ceo', 'research'],
    }],
  }), [])
})

test('reports a loop node without a configured target agent', () => {
  const issues = auditWorkflowTopology({
    agents,
    activeAgentIds: new Set(['research']),
    statuses: [{ id: 'delegate' }],
    filters: [],
    routes: [
      { ownerAgentId: 'research', sourceId: 'research', targetId: 'return-loop' },
    ],
    terminals: [],
    loopNodes: [{ id: 'return-loop', ownerAgentId: 'research', targetAgentId: '' }],
  })

  assert.equal(issues.some((issue) =>
    issue.code === 'missing-target' &&
    issue.detail.includes('Rücksprung-Baustein'),
  ), true)
})
