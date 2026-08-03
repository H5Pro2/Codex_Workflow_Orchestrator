export type WorkflowBoardAgentIds = Record<string, string[]>
export type WorkflowBoardNodeIds = Record<string, string[]>

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

export function pruneWorkflowBoardAgentIds(
  current: WorkflowBoardAgentIds,
  validAgentIds: readonly string[],
) {
  const validIds = new Set(validAgentIds)
  let changed = false
  const next = Object.fromEntries(
    Object.entries(current).flatMap(([ownerId, memberIds]) => {
      if (!Array.isArray(memberIds)) {
        changed = true
        return []
      }
      if (!ownerId.startsWith('project:')) {
        changed = true
        return []
      }
      const members = Array.from(new Set(memberIds.filter((id) => validIds.has(id))))
      if (!sameStringArray(memberIds, members)) changed = true
      return [[ownerId, members]]
    }),
  )
  return changed ? next : current
}

export function pruneWorkflowBoardNodeIds(
  current: WorkflowBoardNodeIds,
  validNodeIds: readonly string[],
) {
  const validIds = new Set(validNodeIds)
  let changed = false
  const next = Object.fromEntries(
    Object.entries(current).flatMap(([dashboardId, memberIds]) => {
      if (!Array.isArray(memberIds)) {
        changed = true
        return []
      }
      const members = Array.from(new Set(memberIds.filter((id) => validIds.has(id))))
      if (members.length === 0) {
        changed = true
        return []
      }
      if (!sameStringArray(memberIds, members)) changed = true
      return [[dashboardId, members]]
    }),
  )
  return changed ? next : current
}

function workflowPositionKeyParts(key: string) {
  if (!key.startsWith('project:')) return null
  const separator = key.lastIndexOf(':')
  return separator > 'project:'.length
    ? { nodeId: key.slice(separator + 1) }
    : null
}

export function pruneWorkflowPositions(
  current: Record<string, { x: number; y: number }>,
  validOwnerIds: readonly string[],
  validNodeIds: readonly string[],
) {
  void validOwnerIds
  const nodes = new Set(validNodeIds)
  const entries = Object.entries(current).filter(([key]) => {
    const parts = workflowPositionKeyParts(key)
    return Boolean(parts && nodes.has(parts.nodeId))
  })
  return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries)
}
