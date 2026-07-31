import test from 'node:test'
import assert from 'node:assert/strict'
import { diagnoseWorkflowStall } from './workflow-supervisor.ts'

const base = {
  agentName: 'Forschungsagent',
  automationEnabled: true,
  activeRouteCount: 1,
  deliveryCount: 0,
  statusKind: 'valid' as const,
  statusNames: ['Weiterleiten'],
  fixedForwardingEnabled: false,
}

test('diagnoses a missing fixed-forwarding target', () => {
  const diagnosis = diagnoseWorkflowStall({
    ...base,
    fixedForwardingEnabled: true,
  })

  assert.equal(diagnosis.cause, 'missing-route')
  assert.match(diagnosis.summary, /kein Zielagent/)
  assert.match(diagnosis.nextStep, /genau einen Zielagenten/)
})

test('diagnoses an invalid status before treating it as a route problem', () => {
  const diagnosis = diagnoseWorkflowStall({
    ...base,
    statusKind: 'unknown',
    statusNames: ['Nicht eingerichtet'],
  })

  assert.equal(diagnosis.cause, 'missing-status')
  assert.match(diagnosis.summary, /Nicht eingerichtet/)
})

test('diagnoses an incomplete follow-up as a blocked task', () => {
  const diagnosis = diagnoseWorkflowStall({
    ...base,
    blockedFollowUp: true,
  })

  assert.equal(diagnosis.cause, 'blocked-follow-up')
  assert.match(diagnosis.nextStep, /Arbeitsobjekt/)
})

test('does not suggest a workflow repair when automation is off', () => {
  const diagnosis = diagnoseWorkflowStall({
    ...base,
    automationEnabled: false,
    fixedForwardingIssue: 'invalid target',
  })

  assert.equal(diagnosis.cause, 'automation-off')
  assert.match(diagnosis.nextStep, /Automatik aktivieren/)
})
