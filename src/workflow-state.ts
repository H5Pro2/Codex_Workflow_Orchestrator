export type WorkflowBoardAgentIds = Record<string, string[]>

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
      if (!validIds.has(ownerId) || !Array.isArray(memberIds)) {
        changed = true
        return []
      }
      const members = Array.from(new Set([ownerId, ...memberIds.filter((id) => validIds.has(id))]))
      if (!sameStringArray(memberIds, members)) changed = true
      return [[ownerId, members]]
    }),
  )
  return changed ? next : current
}

export function pruneWorkflowPositions(
  current: Record<string, { x: number; y: number }>,
  validOwnerIds: readonly string[],
  validNodeIds: readonly string[],
) {
  const owners = new Set(validOwnerIds)
  const nodes = new Set(validNodeIds)
  const entries = Object.entries(current).filter(([key]) => {
    const separator = key.indexOf(':')
    return separator > 0 && owners.has(key.slice(0, separator)) && nodes.has(key.slice(separator + 1))
  })
  return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries)
}
