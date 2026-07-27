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
  _routes: readonly StatusRouteRef[],
) {
  const explicitIds = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string' && Boolean(id.trim()))
    : []
  const dashboardIds = filters
    .filter((filter) => filter.ownerAgentId === agentId)
    .map((filter) => filter.statusId)
    .filter(Boolean)

  return Array.from(new Set(
    [...explicitIds, ...dashboardIds],
  ))
}
