import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendWorkflowRunEntry,
  ensureWorkflowRun,
  normalizeWorkflowRuntime,
  removeWorkflowCheckpoint,
  resumableWorkflowCheckpoint,
  saveWorkflowCheckpoint,
  workflowRunEntry,
} from './workflow-runtime.ts'

test('creates one active run and keeps ordered entries', () => {
  const first = ensureWorkflowRun(normalizeWorkflowRuntime(null), 'C:\\Project', '2026-01-01T00:00:00Z', 'run-1')
  const second = appendWorkflowRunEntry(
    first.runtime,
    'c:/project',
    workflowRunEntry('agent-completed', { agentId: 'ceo', detail: 'Ergebnis' }, '2026-01-01T00:01:00Z'),
  )

  assert.equal(second.runs.length, 1)
  assert.equal(second.runs[0].id, 'run-1')
  assert.equal(second.runs[0].entries[0].detail, 'Ergebnis')
})

test('selects and removes a pending project checkpoint', () => {
  const base = ensureWorkflowRun(normalizeWorkflowRuntime({}), 'C:\\Project', '2026-01-01T00:00:00Z', 'run-1')
  const checkpoint = {
    id: 'checkpoint-1',
    runId: 'run-1',
    projectPath: 'C:\\Project',
    sourceAgentId: 'lead',
    sourceAgentName: 'Leitung',
    sourceTurnId: 'turn-1',
    targetAgentIds: ['world'],
    targetAgentNames: ['Weltforscher'],
    statusIds: ['status-world'],
    statusNames: ['Weltquellen prüfen'],
    result: 'Auftrag',
    state: 'pending' as const,
    reason: '',
    createdAt: '2026-01-01T00:01:00Z',
    updatedAt: '2026-01-01T00:01:00Z',
  }
  const saved = saveWorkflowCheckpoint(base.runtime, checkpoint)

  assert.equal(resumableWorkflowCheckpoint(saved, 'c:/project')?.id, 'checkpoint-1')
  assert.equal(resumableWorkflowCheckpoint(removeWorkflowCheckpoint(saved, 'checkpoint-1'), 'C:\\Project'), null)
})
