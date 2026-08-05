import assert from 'node:assert/strict'
import test from 'node:test'
import {
  appendWorkflowRunEntry,
  advanceWorkflowRunCycle,
  activeWorkflowRun,
  beginWorkflowRun,
  ensureWorkflowRun,
  isOrphanedPendingCheckpoint,
  latestProjectRunIsCleanlyClosed,
  shouldRecoverPendingCheckpoint,
  isRecoverableContinuationCandidate,
  normalizeWorkflowRuntime,
  removeProjectCheckpointsSupersededAt,
  resetProjectWorkflowRuntime,
  removeWorkflowCheckpoint,
  removeWorkflowProjectCheckpoints,
  resumableWorkflowCheckpoint,
  saveWorkflowCheckpoint,
  workflowRunEntry,
  workflowRunCycleProgress,
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

test('preserves configured target cycles for an implicitly continued run', () => {
  const ensured = ensureWorkflowRun(
    normalizeWorkflowRuntime(null),
    'C:\\Project',
    '2026-01-01T00:00:00Z',
    'run-1',
    { cycle: 1, targetCycles: 3 },
  )
  const paused = appendWorkflowRunEntry(
    ensured.runtime,
    'c:/project',
    workflowRunEntry('handoff-pending', { detail: 'Fortsetzung vorgemerkt' }, '2026-01-01T00:01:00Z'),
  )

  assert.equal(paused.runs[0].cycle, 1)
  assert.equal(paused.runs[0].targetCycles, 3)
})

test('advances complete workflow cycles up to the configured target', () => {
  const first = beginWorkflowRun(
    normalizeWorkflowRuntime(null),
    'C:\\Project',
    '2026-01-01T00:00:00Z',
    'run-1',
    { cycle: 1, targetCycles: 3 },
  )
  const secondCycle = advanceWorkflowRunCycle(
    first.runtime,
    'C:\\Project',
    workflowRunEntry('completed', { detail: 'Lauf 1 beendet' }, '2026-01-01T00:01:00Z'),
    workflowRunEntry('started', { detail: 'Lauf 2 gestartet' }, '2026-01-01T00:01:01Z'),
  )

  assert.deepEqual(workflowRunCycleProgress(secondCycle, 'c:/project'), {
    cycle: 2,
    targetCycles: 3,
    shouldContinue: true,
  })
  assert.equal(secondCycle.runs[0].status, 'active')
  assert.equal(secondCycle.runs[1].status, 'completed')

  const thirdCycle = advanceWorkflowRunCycle(
    secondCycle,
    'C:\\Project',
    workflowRunEntry('completed', { detail: 'Lauf 2 beendet' }, '2026-01-01T00:02:00Z'),
    workflowRunEntry('started', { detail: 'Lauf 3 gestartet' }, '2026-01-01T00:02:01Z'),
  )
  const completed = advanceWorkflowRunCycle(
    thirdCycle,
    'C:\\Project',
    workflowRunEntry('completed', { detail: 'Lauf 3 beendet' }, '2026-01-01T00:03:00Z'),
    workflowRunEntry('started', { detail: 'Nicht gestartet' }, '2026-01-01T00:03:01Z'),
  )

  assert.equal(activeWorkflowRun(completed, 'C:\\Project'), null)
  assert.equal(completed.runs.filter((run) => run.status === 'completed').length, 3)
})

test('recognizes a cleanly closed latest project run', () => {
  const completed = appendWorkflowRunEntry(
    beginWorkflowRun(
      normalizeWorkflowRuntime(null),
      'C:\\Project',
      '2026-01-01T00:00:00Z',
      'run-1',
      { cycle: 3, targetCycles: 3 },
    ).runtime,
    'C:\\Project',
    workflowRunEntry('completed', { detail: 'Lauf 3/3 abgeschlossen' }, '2026-01-01T00:01:00Z'),
  )

  assert.equal(latestProjectRunIsCleanlyClosed(completed, 'c:/project'), true)

  const restarted = beginWorkflowRun(
    completed,
    'C:\\Project',
    '2026-01-01T00:02:00Z',
    'run-2',
    { cycle: 1, targetCycles: 3 },
  ).runtime
  assert.equal(latestProjectRunIsCleanlyClosed(restarted, 'c:/project'), false)
})

test('removes stale continuation recovery created after final completion', () => {
  const runtime = normalizeWorkflowRuntime({
    runs: [
      {
        id: 'ghost-run',
        projectPath: 'C:\\Project',
        startedAt: '2026-01-01T00:00:01Z',
        updatedAt: '2026-01-01T00:10:00Z',
        status: 'active',
        cycle: 1,
        targetCycles: 3,
        entries: [
          workflowRunEntry('handoff-pending', { detail: 'alte Fortsetzung' }, '2026-01-01T00:00:01Z'),
          workflowRunEntry('agent-completed', { detail: 'Folgearbeit aus Ghost-Checkpoint' }, '2026-01-01T00:10:00Z'),
        ],
      },
      {
        id: 'final-run',
        projectPath: 'C:\\Project',
        startedAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        status: 'completed',
        cycle: 3,
        targetCycles: 3,
        entries: [
          workflowRunEntry('completed', { detail: 'Lauf 3/3 abgeschlossen' }, '2026-01-01T00:00:00Z'),
        ],
      },
    ],
    checkpoints: [
      { id: 'ghost-checkpoint', runId: 'ghost-run', projectPath: 'C:\\Project' },
    ],
  })

  assert.deepEqual(runtime.runs.map((run) => run.id), ['final-run'])
  assert.deepEqual(runtime.checkpoints, [])
})

test('keeps deliberate runs started after final completion', () => {
  const runtime = normalizeWorkflowRuntime({
    runs: [
      {
        id: 'new-run',
        projectPath: 'C:\\Project',
        startedAt: '2026-01-01T00:00:01Z',
        updatedAt: '2026-01-01T00:00:01Z',
        status: 'active',
        cycle: 1,
        targetCycles: 3,
        entries: [
          workflowRunEntry('started', { detail: 'neuer Lauf' }, '2026-01-01T00:00:01Z'),
        ],
      },
      {
        id: 'final-run',
        projectPath: 'C:\\Project',
        startedAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        status: 'completed',
        cycle: 3,
        targetCycles: 3,
        entries: [
          workflowRunEntry('completed', { detail: 'Lauf 3/3 abgeschlossen' }, '2026-01-01T00:00:00Z'),
        ],
      },
    ],
    checkpoints: [],
  })

  assert.deepEqual(runtime.runs.map((run) => run.id), ['new-run', 'final-run'])
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

test('selects a pending result checkpoint even before a target is known', () => {
  const base = ensureWorkflowRun(normalizeWorkflowRuntime({}), 'C:\\Project', '2026-01-01T00:00:00Z', 'run-1')
  const saved = saveWorkflowCheckpoint(base.runtime, {
    id: 'result-1',
    runId: 'run-1',
    projectPath: 'C:\\Project',
    sourceAgentId: 'researcher',
    sourceAgentName: 'Forscher',
    sourceTurnId: 'turn-1',
    targetAgentIds: [],
    targetAgentNames: [],
    statusIds: [],
    statusNames: [],
    result: 'Ergebnis ohne auswertbare Statuszeile',
    state: 'pending',
    reason: '',
    createdAt: '2026-01-01T00:01:00Z',
    updatedAt: '2026-01-01T00:01:00Z',
  })
  assert.equal(resumableWorkflowCheckpoint(saved, 'c:/project')?.id, 'result-1')
})

test('drops pending internal workflow error checkpoints during normalization', () => {
  const runtime = normalizeWorkflowRuntime({
    runs: [],
    checkpoints: [
      {
        id: 'internal-error',
        projectPath: 'C:\\Project',
        statusIds: ['system:internal-workflow-error'],
        state: 'pending',
      },
      {
        id: 'normal',
        projectPath: 'C:\\Project',
        statusIds: ['status-review'],
        state: 'pending',
      },
    ],
  })

  assert.deepEqual(runtime.checkpoints.map((checkpoint) => checkpoint.id), ['normal'])
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

test('does not recover a fresh checkpoint while dispatch state is settling', () => {
  const checkpoint = {
    id: 'checkpoint-1',
    runId: 'run-1',
    projectPath: 'C:\\Project',
    sourceAgentId: 'lead',
    sourceAgentName: 'Leitung',
    sourceTurnId: 'turn-1',
    targetAgentIds: ['review'],
    targetAgentNames: ['Prüfung'],
    statusIds: ['forward'],
    statusNames: ['Weiterleiten'],
    result: 'Auftrag',
    state: 'pending' as const,
    reason: '',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:10Z',
  }
  const idleAgents = [
    { id: 'lead', status: 'fertig', pendingTurnId: '' },
    { id: 'review', status: 'wartet', pendingTurnId: '' },
  ]

  assert.equal(shouldRecoverPendingCheckpoint(
    checkpoint,
    idleAgents,
    Date.parse('2026-01-01T00:00:20Z'),
    15_000,
  ), false)
  assert.equal(shouldRecoverPendingCheckpoint(
    checkpoint,
    idleAgents,
    Date.parse('2026-01-01T00:00:26Z'),
    15_000,
  ), true)
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

test('removes only checkpoints for the completed project', () => {
  const runtime = normalizeWorkflowRuntime({
    runs: [],
    checkpoints: [
      {
        id: 'project-checkpoint',
        runId: 'run-1',
        projectPath: 'C:\\Project',
        sourceAgentId: 'lead',
        sourceAgentName: 'Leitung',
        sourceTurnId: 'turn-1',
        targetAgentIds: ['review'],
        targetAgentNames: ['Prüfung'],
        statusIds: [],
        statusNames: [],
        result: 'Auftrag',
        state: 'pending',
        reason: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      {
        id: 'other-checkpoint',
        runId: 'run-2',
        projectPath: 'C:\\Other',
        sourceAgentId: 'lead',
        sourceAgentName: 'Leitung',
        sourceTurnId: 'turn-1',
        targetAgentIds: ['review'],
        targetAgentNames: ['Prüfung'],
        statusIds: [],
        statusNames: [],
        result: 'Auftrag',
        state: 'pending',
        reason: '',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      },
    ],
  })

  assert.deepEqual(
    removeWorkflowProjectCheckpoints(runtime, 'C:\\Project').checkpoints.map((checkpoint) => checkpoint.id),
    ['other-checkpoint'],
  )
})

test('compacts persisted workflow history without removing recent run structure', () => {
  const runtime = normalizeWorkflowRuntime({
    runs: Array.from({ length: 15 }, (_, runIndex) => ({
      id: `run-${runIndex}`,
      projectPath: 'C:\\Project',
      startedAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      status: runIndex === 0 ? 'active' : 'completed',
      entries: Array.from({ length: 100 }, (_, entryIndex) => ({
        id: `entry-${runIndex}-${entryIndex}`,
        at: '2026-01-01T00:00:00Z',
        kind: 'agent-completed',
        agentId: 'agent',
        agentName: 'Agent',
        targetAgentIds: [],
        targetAgentNames: [],
        statusIds: [],
        statusNames: [],
        detail: 'x'.repeat(2_000),
      })),
    })),
    checkpoints: [],
  })

  assert.equal(runtime.runs.length, 12)
  assert.equal(runtime.runs[0].id, 'run-0')
  assert.equal(runtime.runs[0].status, 'active')
  assert.equal(runtime.runs[0].entries.length, 80)
  assert.equal(runtime.runs[0].entries[0].id, 'entry-0-20')
  assert.equal(runtime.runs[0].entries[0].detail.length, 1_500)
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
  assert.equal(reset.runs[0].entries.at(-1)?.kind, 'reset')
  assert.equal(reset.runs[0].entries.at(-1)?.detail, 'Arbeitslauf durch den Benutzer zurückgesetzt.')
  assert.equal(reset.runs[1].status, 'active')
  assert.deepEqual(reset.checkpoints.map((checkpoint) => checkpoint.id), ['other-checkpoint'])
})
