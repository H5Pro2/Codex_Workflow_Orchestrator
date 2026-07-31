export const MIN_WORKFLOW_LOOPS = 1
export const MAX_WORKFLOW_LOOPS = 20

export type WorkflowLoopCounts = Record<string, number>

export function normalizeWorkflowLoopCount(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return MIN_WORKFLOW_LOOPS
  return Math.min(MAX_WORKFLOW_LOOPS, Math.max(MIN_WORKFLOW_LOOPS, Math.trunc(parsed)))
}

export function normalizeWorkflowLoopCounts(value: unknown): WorkflowLoopCounts {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).map(([projectId, count]) => [projectId, normalizeWorkflowLoopCount(count)]),
  )
}

export function workflowLoopCountForProject(counts: WorkflowLoopCounts, projectId: string) {
  return normalizeWorkflowLoopCount(counts[projectId])
}

export function setWorkflowLoopCount(
  counts: WorkflowLoopCounts,
  projectId: string,
  count: unknown,
): WorkflowLoopCounts {
  if (!projectId) return counts
  return { ...counts, [projectId]: normalizeWorkflowLoopCount(count) }
}
