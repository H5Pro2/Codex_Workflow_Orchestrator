export type WorkflowRunEntryKind =
  | 'started'
  | 'resumed'
  | 'status-repair'
  | 'agent-completed'
  | 'handoff-pending'
  | 'handoff-delivered'
  | 'paused'
  | 'completed'

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
  detail: string
}

export type WorkflowRun = {
  id: string
  projectPath: string
  startedAt: string
  updatedAt: string
  status: 'active' | 'paused' | 'completed'
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
const MAX_RUNS = 25
const MAX_ENTRIES_PER_RUN = 250
const MAX_CHECKPOINT_RESULT_LENGTH = 12_000

function samePath(left: string, right: string) {
  return left.trim().replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE') ===
    right.trim().replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE')
}

export function normalizeWorkflowRuntime(value: unknown): WorkflowRuntime {
  if (!value || typeof value !== 'object') return EMPTY_RUNTIME
  const candidate = value as Partial<WorkflowRuntime>
  return {
    runs: Array.isArray(candidate.runs) ? candidate.runs : [],
    checkpoints: Array.isArray(candidate.checkpoints) ? candidate.checkpoints : [],
  }
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
) {
  const active = activeWorkflowRun(runtime, projectPath)
  if (active) return { runtime, run: active }

  const run: WorkflowRun = {
    id,
    projectPath,
    startedAt: now,
    updatedAt: now,
    status: 'active',
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
    detail: values.detail ?? '',
  }
}
