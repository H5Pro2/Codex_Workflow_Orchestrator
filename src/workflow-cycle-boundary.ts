import type { WorkflowRun } from './workflow-runtime.ts'

export function wouldCompleteWorkflowCycleOnReturn({
  run,
  sourceAgentId,
  targetAgentIds,
  initialAgentIds,
}: {
  run: WorkflowRun | null
  sourceAgentId: string
  targetAgentIds: readonly string[]
  initialAgentIds: ReadonlySet<string>
}) {
  if (!run || !sourceAgentId || initialAgentIds.size === 0) return false
  if (initialAgentIds.has(sourceAgentId)) return false
  if (!targetAgentIds.some((targetId) => initialAgentIds.has(targetId))) return false

  return run.entries.some((entry) =>
    entry.kind === 'handoff-delivered' &&
    entry.targetAgentIds.includes(sourceAgentId),
  )
}
