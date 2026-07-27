import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendWorkflowRunEntry,
  ensureWorkflowRun,
  isOrphanedPendingCheckpoint,
  isRecoverableContinuationCandidate,
  normalizeWorkflowRuntime,
  removeProjectCheckpointsSupersededAt,
  resetProjectWorkflowRuntime,
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

test('a newer manual management decision supersedes old project checkpoints', () => {
  const runtime = normalizeWorkflowRuntime({
    checkpoints: [
      {
        id: 'old-project',
        projectPath: 'C:\\Project',
        updatedAt: '2026-01-01T00:01:00Z',
        state: 'blocked',
      },
      {
        id: 'new-project',
        projectPath: 'C:\\Project',
        updatedAt: '2026-01-01T00:03:00Z',
        state: 'pending',
      },
      {
        id: 'other-project',
        projectPath: 'C:\\Other',
        updatedAt: '2026-01-01T00:01:00Z',
        state: 'pending',
      },
    ],
  })
  const result = removeProjectCheckpointsSupersededAt(
    runtime,
    'c:/project',
    '2026-01-01T00:02:00Z',
  )
  assert.deepEqual(result.checkpoints.map((checkpoint) => checkpoint.id), [
    'new-project',
    'other-project',
  ])
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

test('recognizes a pending handoff orphaned by an application restart', () => {
  const checkpoint = {
    id: 'checkpoint-1',
    runId: 'run-1',
    projectPath: 'C:\\Project',
    sourceAgentId: 'lead',
    sourceAgentName: 'Leitung',
    sourceTurnId: 'turn-1',
    targetAgentIds: ['video'],
    targetAgentNames: ['Video'],
    statusIds: ['search'],
    statusNames: ['Quellen suchen'],
    result: 'Auftrag',
    state: 'pending' as const,
    reason: '',
    createdAt: '2026-01-01T00:01:00Z',
    updatedAt: '2026-01-01T00:01:00Z',
  }
  assert.equal(isOrphanedPendingCheckpoint(checkpoint, [
    { id: 'lead', status: 'fertig', pendingTurnId: '' },
    { id: 'video', status: 'wartet', pendingTurnId: '' },
  ]), true)
  assert.equal(isOrphanedPendingCheckpoint(checkpoint, [
    { id: 'lead', status: 'fertig', pendingTurnId: '' },
    { id: 'video', status: 'laeuft', pendingTurnId: 'turn-2' },
  ]), false)
})

test('does not recover historical agents after a clean workflow stop', () => {
  assert.equal(isRecoverableContinuationCandidate({
    status: 'weitergegeben',
    lastResult: 'Altes Ergebnis',
    lastCompletedTurnId: 'turn-old',
  }), false)
  assert.equal(isRecoverableContinuationCandidate({
    status: 'fertig',
    lastResult: 'Noch nicht weitergegebenes Ergebnis',
    lastCompletedTurnId: 'turn-current',
  }), true)
})

test('resets only the selected project run and keeps its history', () => {
  const runtime = normalizeWorkflowRuntime({
    runs: [
      {
        id: 'selected-run',
        projectPath: 'C:\\Project',
        status: 'active',
        updatedAt: '2026-01-01T00:00:00Z',
        entries: [],
      },
      {
        id: 'other-run',
        projectPath: 'C:\\Other',
        status: 'active',
        updatedAt: '2026-01-01T00:00:00Z',
        entries: [],
      },
    ],
    checkpoints: [
      { id: 'selected-checkpoint', projectPath: 'C:\\Project' },
      { id: 'other-checkpoint', projectPath: 'C:\\Other' },
    ],
  })

  const reset = resetProjectWorkflowRuntime(runtime, 'c:/project', '2026-01-01T01:00:00Z')

  assert.equal(reset.runs[0].status, 'completed')
  assert.equal(reset.runs[0].entries.at(-1)?.detail, 'Arbeitslauf durch den Benutzer zurückgesetzt.')
  assert.equal(reset.runs[1].status, 'active')
  assert.deepEqual(reset.checkpoints.map((checkpoint) => checkpoint.id), ['other-checkpoint'])
})
