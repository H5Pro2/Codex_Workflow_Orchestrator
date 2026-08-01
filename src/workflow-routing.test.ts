import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  resolveConfiguredDeliveries,
  resolveUnconditionalForwarding,
  wouldCreateUnsupportedUnconditionalForwardCycle,
} from './workflow-routing.ts'

const route = (id: string, sourceId: string, targetId: string) => ({
  id,
  sourceId,
  targetId,
  condition: '',
  prompt: '',
})

test('routes only the status selected by the validated protocol signal', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'ceo',
    result: 'Weiter an Frontend',
    resultStatusIds: ['forward'],
    routes: [
      route('ceo-filter', 'ceo', 'forward-filter'),
      route('filter-frontend', 'forward-filter', 'frontend'),
      route('ceo-error', 'ceo', 'error-filter'),
      route('error-diagnostics', 'error-filter', 'diagnostics'),
    ],
    statusFilters: [
      { id: 'forward-filter', statusId: 'forward' },
      { id: 'error-filter', statusId: 'error' },
    ],
    promptNodes: [],
    targetIds: new Set(['frontend', 'diagnostics']),
    stopIds: new Set(),
  })
  assert.deepEqual(deliveries.map((delivery) => delivery.targetId), ['frontend'])
})

test('does not infer a route from prose or an unvalidated status', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'ceo',
    result: 'Bitte an Frontend weitergeben.',
    resultStatusIds: [],
    routes: [route('ceo-filter', 'ceo', 'forward-filter'), route('filter-frontend', 'forward-filter', 'frontend')],
    statusFilters: [{ id: 'forward-filter', statusId: 'forward' }],
    promptNodes: [],
    targetIds: new Set(['frontend']),
    stopIds: new Set(),
  })
  assert.deepEqual(deliveries, [])
})

test('resolves configured stop paths', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'qa',
    result: 'Abgeschlossen',
    resultStatusIds: ['done'],
    routes: [route('qa-filter', 'qa', 'done-filter'), route('filter-stop', 'done-filter', 'project-stop')],
    statusFilters: [{ id: 'done-filter', statusId: 'done' }],
    promptNodes: [],
    targetIds: new Set(),
    stopIds: new Set(['project-stop']),
  })
  assert.deepEqual(deliveries.map((delivery) => delivery.stopId), ['project-stop'])
})

test('routes an interval forwarding node through normal and interval outputs', () => {
  const routes = [
    route('agent-forward', 'agent', 'forward-node'),
    { ...route('forward-normal', 'forward-node', 'reviewer'), sourceHandle: 'output' },
    { ...route('forward-interval', 'forward-node', 'auditor'), sourceHandle: 'interval' },
  ]
  const resolveAt = (intervalCount: number) => resolveConfiguredDeliveries({
    sourceId: 'agent',
    result: 'Ergebnis',
    resultStatusIds: [],
    routes,
    statusFilters: [],
    promptNodes: [{ id: 'forward-node', condition: '', prompt: 'Weiter', interval: 5, intervalCount }],
    targetIds: new Set(['reviewer', 'auditor']),
    stopIds: new Set(),
  })

  assert.deepEqual(resolveAt(3).map((delivery) => ({
    targetId: delivery.targetId,
    branch: delivery.promptBranch,
    nextCount: delivery.promptNextCount,
  })), [{ targetId: 'reviewer', branch: 'normal', nextCount: 4 }])
  assert.deepEqual(resolveAt(4).map((delivery) => ({
    targetId: delivery.targetId,
    branch: delivery.promptBranch,
    nextCount: delivery.promptNextCount,
  })), [{ targetId: 'auditor', branch: 'interval', nextCount: 0 }])
})

test('deduplicates multiple matching routes to the same target', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'researcher',
    result: 'Prüfung und Weitergabe',
    resultStatusIds: ['review', 'forward'],
    routes: [
      route('researcher-review', 'researcher', 'review-filter'),
      route('review-reviewer', 'review-filter', 'reviewer'),
      route('researcher-forward', 'researcher', 'forward-filter'),
      route('forward-reviewer', 'forward-filter', 'reviewer'),
    ],
    statusFilters: [
      { id: 'review-filter', statusId: 'review' },
      { id: 'forward-filter', statusId: 'forward' },
    ],
    promptNodes: [],
    targetIds: new Set(['reviewer']),
    stopIds: new Set(),
  })
  assert.deepEqual(deliveries.map((delivery) => delivery.targetId), ['reviewer'])
})

test('fixed forwarding resolves exactly one connected target without a text status', () => {
  const resolved = resolveUnconditionalForwarding({
    sourceId: 'developer',
    statusId: 'system-forward',
    routes: [
      route('developer-filter', 'developer', 'forward-filter'),
      route('filter-reviewer', 'forward-filter', 'reviewer'),
    ],
    statusFilters: [{ id: 'forward-filter', statusId: 'system-forward' }],
    targetIds: new Set(['reviewer']),
  })
  assert.equal(resolved.enabled, true)
  assert.equal(resolved.delivery?.targetId, 'reviewer')
  assert.equal(resolved.issue, '')
})

test('fixed forwarding rejects multiple target agents', () => {
  const resolved = resolveUnconditionalForwarding({
    sourceId: 'developer',
    statusId: 'system-forward',
    routes: [
      route('developer-filter', 'developer', 'forward-filter'),
      route('filter-reviewer', 'forward-filter', 'reviewer'),
      route('filter-qa', 'forward-filter', 'qa'),
    ],
    statusFilters: [{ id: 'forward-filter', statusId: 'system-forward' }],
    targetIds: new Set(['reviewer', 'qa']),
  })
  assert.equal(resolved.enabled, true)
  assert.equal(resolved.delivery, null)
  assert.match(resolved.issue, /genau einem Zielagenten/u)
})

test('fixed forwarding allows a deliberate two-agent cycle', () => {
  assert.equal(wouldCreateUnsupportedUnconditionalForwardCycle({
    sourceAgentId: 'reviewer',
    targetAgentId: 'researcher',
    statusId: 'system-forward',
    routes: [
      route('researcher-filter', 'researcher', 'researcher-forward'),
      route('researcher-reviewer', 'researcher-forward', 'reviewer'),
      route('reviewer-filter', 'reviewer', 'reviewer-forward'),
    ],
    statusFilters: [
      { id: 'researcher-forward', ownerAgentId: 'researcher', statusId: 'system-forward' },
      { id: 'reviewer-forward', ownerAgentId: 'reviewer', statusId: 'system-forward' },
    ],
  }), false)
})

test('fixed forwarding rejects a cycle with three agents', () => {
  assert.equal(wouldCreateUnsupportedUnconditionalForwardCycle({
    sourceAgentId: 'reviewer',
    targetAgentId: 'ceo',
    statusId: 'system-forward',
    routes: [
      route('ceo-filter', 'ceo', 'ceo-forward'),
      route('ceo-developer', 'ceo-forward', 'developer'),
      route('developer-filter', 'developer', 'developer-forward'),
      route('developer-reviewer', 'developer-forward', 'reviewer'),
      route('reviewer-filter', 'reviewer', 'reviewer-forward'),
    ],
    statusFilters: [
      { id: 'ceo-forward', ownerAgentId: 'ceo', statusId: 'system-forward' },
      { id: 'developer-forward', ownerAgentId: 'developer', statusId: 'system-forward' },
      { id: 'reviewer-forward', ownerAgentId: 'reviewer', statusId: 'system-forward' },
    ],
  }), true)
})
