import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  INTERNAL_WORKFLOW_ERROR_STATUS_ID,
  internalWorkflowErrorManagerId,
  internalWorkflowErrorStatus,
  isInternalWorkflowErrorStatus,
  shouldEscalateInternalWorkflowError,
} from './internal-workflow-error.ts'

const specialist = { id: 'specialist', projectPath: 'C:\\Research', assignment: 'agent' as const }
const manager = { id: 'ceo', projectPath: 'c:/research/', assignment: 'management' as const }

test('provides one reserved internal workflow error status', () => {
  const status = internalWorkflowErrorStatus(specialist.projectPath)
  assert.equal(status.id, INTERNAL_WORKFLOW_ERROR_STATUS_ID)
  assert.match(status.description, /kein Projektfehler/)
  assert.equal(isInternalWorkflowErrorStatus([status.id]), true)
  assert.equal(isInternalWorkflowErrorStatus([status.id, 'other']), false)
})

test('routes a specialist internal workflow error to the project manager only', () => {
  assert.equal(internalWorkflowErrorManagerId(specialist, [specialist, manager]), manager.id)
  assert.equal(internalWorkflowErrorManagerId(manager, [specialist, manager]), '')
  assert.equal(internalWorkflowErrorManagerId(specialist, [
    specialist,
    { ...manager, id: 'other-ceo', projectPath: 'C:\\Other' },
  ]), '')
})

test('escalates an explicit status gap and one failed protocol repair', () => {
  assert.equal(shouldEscalateInternalWorkflowError({
    assignment: 'agent',
    signalKind: 'valid',
    runPurpose: 'handoff',
    statusIds: [INTERNAL_WORKFLOW_ERROR_STATUS_ID],
  }), true)
  assert.equal(shouldEscalateInternalWorkflowError({
    assignment: 'agent',
    signalKind: 'none',
    runPurpose: 'handoff',
    statusIds: [],
  }), true)
  assert.equal(shouldEscalateInternalWorkflowError({
    assignment: 'agent',
    signalKind: 'missing',
    runPurpose: 'status-repair',
    statusIds: [],
  }), true)
  assert.equal(shouldEscalateInternalWorkflowError({
    assignment: 'management',
    signalKind: 'none',
    runPurpose: 'handoff',
    statusIds: [],
  }), false)
  assert.equal(shouldEscalateInternalWorkflowError({
    assignment: 'management',
    signalKind: 'valid',
    runPurpose: 'handoff',
    statusIds: [INTERNAL_WORKFLOW_ERROR_STATUS_ID],
  }), true)
})
