export type WorkflowRunEntryKind =
  | 'started'
  | 'resumed'
  | 'status-repair'
  | 'supervisor'
  | 'agent-completed'
  | 'handoff-pending'
  | 'handoff-delivered'
  | 'paused'
  | 'completed'
  | 'reset'

export type WorkflowRunEntry = {
  id: string
  at: string
  kind: WorkflowRunEntryKind
  agentId: string
  agentName: string
  targetAgentIds: string[]
  targetAgentNames: string[]
  statusIds: string[]
  statusNames: string[]
  taskSignature?: string
  detail: string
}

export type WorkflowRun = {
  id: string
  projectPath: string
  startedAt: string
  updatedAt: string
  status: 'active' | 'paused' | 'completed'
  cycle: number
  targetCycles: number
  entries: WorkflowRunEntry[]
}

export type WorkflowCheckpoint = {
  id: string
  runId: string
  projectPath: string
  sourceAgentId: string
  sourceAgentName: string
  sourceTurnId: string
  targetAgentIds: string[]
  targetAgentNames: string[]
  statusIds: string[]
  statusNames: string[]
  result: string
  state: 'pending' | 'blocked'
  reason: string
  createdAt: string
  updatedAt: string
}

export type WorkflowRuntime = {
  runs: WorkflowRun[]
  checkpoints: WorkflowCheckpoint[]
}

const EMPTY_RUNTIME: WorkflowRuntime = { runs: [], checkpoints: [] }
const MAX_RUNS = 12
const MAX_ENTRIES_PER_RUN = 80
const MAX_ENTRY_DETAIL_LENGTH = 1_500
const MAX_CHECKPOINT_RESULT_LENGTH = 12_000
const INTERNAL_WORKFLOW_ERROR_STATUS_ID = 'system:internal-workflow-error'

function normalizeCycle(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(1, Math.trunc(parsed)) : 1
}

function samePath(left: string, right: string) {
  return left.trim().replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE') ===
    right.trim().replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE')
}

export function normalizeWorkflowRuntime(value: unknown, ..._legacyArgs: unknown[]): WorkflowRuntime {
  if (!value || typeof value !== 'object') return EMPTY_RUNTIME
  const candidate = value as Partial<WorkflowRuntime>
  return pruneStaleContinuationRunsAfterCleanClose({
    runs: Array.isArray(candidate.runs)
      ? candidate.runs.slice(0, MAX_RUNS).map((run) => ({
          ...run,
          cycle: normalizeCycle(run.cycle),
          targetCycles: Math.max(normalizeCycle(run.cycle), normalizeCycle(run.targetCycles)),
          entries: Array.isArray(run.entries)
            ? run.entries.slice(-MAX_ENTRIES_PER_RUN).map((entry) => ({
                ...entry,
                detail: typeof entry.detail === 'string'
                  ? entry.detail.slice(0, MAX_ENTRY_DETAIL_LENGTH)
                  : '',
              }))
            : [],
        }))
      : [],
    checkpoints: Array.isArray(candidate.checkpoints)
      ? candidate.checkpoints.filter((checkpoint) =>
          !(Array.isArray(checkpoint.statusIds) &&
            checkpoint.statusIds.length === 1 &&
            checkpoint.statusIds[0] === INTERNAL_WORKFLOW_ERROR_STATUS_ID &&
            checkpoint.state === 'pending'),
        )
      : [],
  })
}

export function activeWorkflowRun(runtime: WorkflowRuntime, projectPath: string) {
  return runtime.runs.find(
    (run) => samePath(run.projectPath, projectPath) && run.status !== 'completed',
  ) ?? null
}

export function ensureWorkflowRun(
  runtime: WorkflowRuntime,
  projectPath: string,
  now: string,
  id = crypto.randomUUID(),
  options: { cycle?: number; targetCycles?: number } = {},
) {
  const active = activeWorkflowRun(runtime, projectPath)
  if (active) return { runtime, run: active }

  const run: WorkflowRun = {
    id,
    projectPath,
    startedAt: now,
    updatedAt: now,
    status: 'active',
    cycle: normalizeCycle(options.cycle),
    targetCycles: Math.max(normalizeCycle(options.cycle), normalizeCycle(options.targetCycles)),
    entries: [],
  }
  return {
    run,
    runtime: { ...runtime, runs: [run, ...runtime.runs].slice(0, MAX_RUNS) },
  }
}

export function beginWorkflowRun(
  runtime: WorkflowRuntime,
  projectPath: string,
  now: string,
  id = crypto.randomUUID(),
  options: { cycle?: number; targetCycles?: number } = {},
) {
  const closedRuns = runtime.runs.map((run) =>
    samePath(run.projectPath, projectPath) && run.status !== 'completed'
      ? { ...run, status: 'completed' as const, updatedAt: now }
      : run,
  )
  const run: WorkflowRun = {
    id,
    projectPath,
    startedAt: now,
    updatedAt: now,
    status: 'active',
    cycle: normalizeCycle(options.cycle),
    targetCycles: Math.max(normalizeCycle(options.cycle), normalizeCycle(options.targetCycles)),
    entries: [],
  }
  return {
    run,
    runtime: {
      runs: [run, ...closedRuns].slice(0, MAX_RUNS),
      checkpoints: runtime.checkpoints.filter(
        (checkpoint) => !samePath(checkpoint.projectPath, projectPath),
      ),
    },
  }
}

export function workflowRunCycleProgress(runtime: WorkflowRuntime, projectPath: string) {
  const run = activeWorkflowRun(runtime, projectPath)
  const cycle = normalizeCycle(run?.cycle)
  const targetCycles = Math.max(cycle, normalizeCycle(run?.targetCycles))
  return { cycle, targetCycles, shouldContinue: cycle < targetCycles }
}

export function latestProjectRunIsCleanlyClosed(runtime: WorkflowRuntime, projectPath: string) {
  const latest = runtime.runs
    .filter((run) => samePath(run.projectPath, projectPath))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]
  if (!latest || latest.status !== 'completed') return false
  const lastEntry = latest.entries.at(-1)
  return lastEntry?.kind === 'completed' || lastEntry?.kind === 'reset'
}

function pruneStaleContinuationRunsAfterCleanClose(runtime: WorkflowRuntime): WorkflowRuntime {
  const staleRunIds = new Set<string>()
  runtime.runs.forEach((run) => {
    if (run.status === 'completed') return
    if (run.cycle !== 1 || run.entries.at(0)?.kind !== 'handoff-pending') return
    const firstEntryAt = Date.parse(run.entries[0]?.at ?? '')
    if (!Number.isFinite(firstEntryAt)) return
    const cleanClose = runtime.runs.find((candidate) => {
      if (!samePath(candidate.projectPath, run.projectPath)) return false
      if (candidate.status !== 'completed') return false
      if (candidate.cycle < candidate.targetCycles) return false
      if (candidate.entries.at(-1)?.kind !== 'completed') return false
      const closedAt = Date.parse(candidate.updatedAt)
      return Number.isFinite(closedAt) && firstEntryAt >= closedAt && firstEntryAt - closedAt < 10_000
    })
    if (cleanClose) staleRunIds.add(run.id)
  })
  if (staleRunIds.size === 0) return runtime
  return {
    runs: runtime.runs.filter((run) => !staleRunIds.has(run.id)),
    checkpoints: runtime.checkpoints.filter((checkpoint) => !staleRunIds.has(checkpoint.runId)),
  }
}

export function advanceWorkflowRunCycle(
  runtime: WorkflowRuntime,
  projectPath: string,
  completedEntry: WorkflowRunEntry,
  startedEntry: WorkflowRunEntry,
) {
  const progress = workflowRunCycleProgress(runtime, projectPath)
  const completed = appendWorkflowRunEntry(runtime, projectPath, completedEntry)
  if (!progress.shouldContinue) return completed
  const next = beginWorkflowRun(completed, projectPath, startedEntry.at, crypto.randomUUID(), {
    cycle: progress.cycle + 1,
    targetCycles: progress.targetCycles,
  })
  return appendWorkflowRunEntry(next.runtime, projectPath, startedEntry)
}

export function appendWorkflowRunEntry(
  runtime: WorkflowRuntime,
  projectPath: string,
  entry: WorkflowRunEntry,
) {
  const ensured = ensureWorkflowRun(runtime, projectPath, entry.at)
  const nextStatus: WorkflowRun['status'] = entry.kind === 'completed'
    ? 'completed'
    : entry.kind === 'paused'
      ? 'paused'
      : 'active'
  return {
    ...ensured.runtime,
    runs: ensured.runtime.runs.map((run) => run.id === ensured.run.id
      ? {
          ...run,
          updatedAt: entry.at,
          status: nextStatus,
          entries: [...run.entries, entry].slice(-MAX_ENTRIES_PER_RUN),
        }
      : run),
  }
}

export function saveWorkflowCheckpoint(
  runtime: WorkflowRuntime,
  checkpoint: WorkflowCheckpoint,
) {
  const normalized = {
    ...checkpoint,
    result: checkpoint.result.slice(0, MAX_CHECKPOINT_RESULT_LENGTH),
  }
  return {
    ...runtime,
    checkpoints: [
      normalized,
      ...runtime.checkpoints.filter((item) =>
        !samePath(item.projectPath, checkpoint.projectPath) ||
        item.sourceAgentId !== checkpoint.sourceAgentId),
    ],
  }
}

export function resumableWorkflowCheckpoint(runtime: WorkflowRuntime, projectPath: string) {
  return runtime.checkpoints.find(
    (checkpoint) => samePath(checkpoint.projectPath, projectPath) && checkpoint.state === 'pending',
  ) ?? null
}

export function isRecoverableContinuationCandidate(agent: {
  status: string
  lastResult: string
  lastCompletedTurnId: string
}) {
  return agent.status === 'fertig' && Boolean(agent.lastResult && agent.lastCompletedTurnId)
}

type CheckpointAgentState = {
  id: string
  status: string
  pendingTurnId: string
}

export function isOrphanedPendingCheckpoint(
  checkpoint: WorkflowCheckpoint,
  agents: CheckpointAgentState[],
) {
  if (checkpoint.state !== 'pending' || checkpoint.targetAgentIds.length === 0) return false
  const source = agents.find((agent) => agent.id === checkpoint.sourceAgentId)
  const targets = checkpoint.targetAgentIds.map((targetId) =>
    agents.find((agent) => agent.id === targetId),
  )
  if (!source || targets.some((target) => !target)) return false
  const isBusy = (agent: CheckpointAgentState) =>
    Boolean(agent.pendingTurnId) || agent.status === 'laeuft'
  return !isBusy(source) && targets.every((target) => !isBusy(target!))
}

export function shouldRecoverPendingCheckpoint(
  checkpoint: WorkflowCheckpoint,
  agents: CheckpointAgentState[],
  now: number,
  graceMs: number,
) {
  const updatedAt = Date.parse(checkpoint.updatedAt)
  if (!Number.isFinite(updatedAt) || now - updatedAt < graceMs) return false
  return isOrphanedPendingCheckpoint(checkpoint, agents)
}

export function removeProjectCheckpointsSupersededAt(
  runtime: WorkflowRuntime,
  projectPath: string,
  supersededAt: string,
) {
  const cutoff = Date.parse(supersededAt)
  if (!Number.isFinite(cutoff)) return runtime
  const checkpoints = runtime.checkpoints.filter((checkpoint) => {
    if (!samePath(checkpoint.projectPath, projectPath)) return true
    const checkpointTime = Date.parse(checkpoint.updatedAt)
    return !Number.isFinite(checkpointTime) || checkpointTime > cutoff
  })
  return checkpoints.length === runtime.checkpoints.length
    ? runtime
    : { ...runtime, checkpoints }
}

export function removeWorkflowCheckpoint(runtime: WorkflowRuntime, checkpointId: string) {
  return {
    ...runtime,
    checkpoints: runtime.checkpoints.filter((checkpoint) => checkpoint.id !== checkpointId),
  }
}

export function removeWorkflowProjectCheckpoints(runtime: WorkflowRuntime, projectPath: string) {
  const checkpoints = runtime.checkpoints.filter(
    (checkpoint) => !samePath(checkpoint.projectPath, projectPath),
  )
  return checkpoints.length === runtime.checkpoints.length
    ? runtime
    : { ...runtime, checkpoints }
}

export function resetProjectWorkflowRuntime(
  runtime: WorkflowRuntime,
  projectPath: string,
  at = new Date().toISOString(),
) {
  const resetEntry = workflowRunEntry('reset', {
    detail: 'Arbeitslauf durch den Benutzer zurückgesetzt.',
  }, at)
  return {
    runs: runtime.runs.map((run) =>
      samePath(run.projectPath, projectPath) && run.status !== 'completed'
        ? {
            ...run,
            status: 'completed' as const,
            updatedAt: at,
            entries: [...run.entries, resetEntry],
          }
        : run,
    ),
    checkpoints: runtime.checkpoints.filter(
      (checkpoint) => !samePath(checkpoint.projectPath, projectPath),
    ),
  }
}

export function workflowRunEntry(
  kind: WorkflowRunEntryKind,
  values: Partial<Omit<WorkflowRunEntry, 'id' | 'at' | 'kind'>> = {},
  at = new Date().toISOString(),
): WorkflowRunEntry {
  return {
    id: crypto.randomUUID(),
    at,
    kind,
    agentId: values.agentId ?? '',
    agentName: values.agentName ?? '',
    targetAgentIds: values.targetAgentIds ?? [],
    targetAgentNames: values.targetAgentNames ?? [],
    statusIds: values.statusIds ?? [],
    statusNames: values.statusNames ?? [],
    taskSignature: values.taskSignature,
    detail: (values.detail ?? '').slice(0, MAX_ENTRY_DETAIL_LENGTH),
  }
}
