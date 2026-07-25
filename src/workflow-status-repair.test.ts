import assert from 'node:assert/strict'
import test from 'node:test'
import {
  shouldRequestWorkflowStatusRepair,
  workflowStatusRepairInstruction,
} from './workflow-status-repair.ts'

test('requests one repair for a malformed routed workflow result', () => {
  assert.equal(shouldRequestWorkflowStatusRepair({
    signalKind: 'ambiguous',
    activeRouteCount: 2,
    runPurpose: 'handoff',
    hasThread: true,
  }), true)
  assert.equal(shouldRequestWorkflowStatusRepair({
    signalKind: 'ambiguous',
    activeRouteCount: 2,
    runPurpose: 'status-repair',
    hasThread: true,
  }), false)
})

test('does not repair missing topology or a valid signal', () => {
  assert.equal(shouldRequestWorkflowStatusRepair({
    signalKind: 'unknown',
    activeRouteCount: 0,
    runPurpose: 'handoff',
    hasThread: true,
  }), false)
  assert.equal(shouldRequestWorkflowStatusRepair({
    signalKind: 'valid',
    activeRouteCount: 1,
    runPurpose: 'handoff',
    hasThread: true,
  }), false)
})

test('builds a correction-only instruction with the allowed statuses', () => {
  const instruction = workflowStatusRepairInstruction(
    'Mehrere Statusangaben.',
    [{ id: 'world', name: 'Weltquellen prüfen', description: 'Zum Weltforscher' }],
  )
  assert.match(instruction, /keine Facharbeit erneut/i)
  assert.match(instruction, /Weltquellen prüfen/)
  assert.match(instruction, /\[Workflow-Status: STATUSNAME\]/)
})
