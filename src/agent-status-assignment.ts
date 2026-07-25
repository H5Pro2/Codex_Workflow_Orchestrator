type StatusFilterRef = {
  id: string
  ownerAgentId: string
  statusId: string
}

type StatusRouteRef = {
  ownerAgentId: string
  sourceId: string
  targetId: string
}

export function explicitAgentStatusIds(
  value: unknown,
  agentId: string,
  filters: readonly StatusFilterRef[],
  routes: readonly StatusRouteRef[],
) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))))
  }

  const outgoingNodeIds = new Set(
    routes
      .filter((route) => route.ownerAgentId === agentId)
      .map((route) => route.sourceId),
  )
  const connectedFilterIds = new Set(
    routes
      .filter((route) =>
        route.ownerAgentId === agentId &&
        route.sourceId === agentId &&
        outgoingNodeIds.has(route.targetId),
      )
      .map((route) => route.targetId),
  )
  return Array.from(new Set(
    filters
      .filter((filter) => filter.ownerAgentId === agentId && connectedFilterIds.has(filter.id))
      .map((filter) => filter.statusId)
      .filter(Boolean),
  ))
}
