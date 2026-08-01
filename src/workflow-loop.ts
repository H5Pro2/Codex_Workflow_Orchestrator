export const MIN_WORKFLOW_LOOPS = 1
export const MAX_WORKFLOW_LOOPS = 999

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

function uniqueProjectKeys(projectId: string, aliases: readonly string[] = []) {
  return [...new Set([projectId, ...aliases].map((key) => key.trim()).filter(Boolean))]
}

export function workflowLoopCountForProject(
  counts: WorkflowLoopCounts,
  projectId: string,
  aliases: readonly string[] = [],
) {
  for (const key of uniqueProjectKeys(projectId, aliases)) {
    if (Object.hasOwn(counts, key)) {
      return normalizeWorkflowLoopCount(counts[key])
    }
  }
  return MIN_WORKFLOW_LOOPS
}

export function setWorkflowLoopCount(
  counts: WorkflowLoopCounts,
  projectId: string,
  count: unknown,
  aliases: readonly string[] = [],
): WorkflowLoopCounts {
  const keys = uniqueProjectKeys(projectId, aliases)
  if (keys.length === 0) return counts
  const normalized = normalizeWorkflowLoopCount(count)
  return Object.fromEntries([
    ...Object.entries(counts),
    ...keys.map((key) => [key, normalized] as const),
  ])
}
