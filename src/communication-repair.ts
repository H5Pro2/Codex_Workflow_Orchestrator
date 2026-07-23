type CommunicationRepairInput = {
  sourceAgentId: string
  activeRouteCount: number
  resultStatusIds: string[]
  dashboardAgentIds: string[]
  knownAgentIds: string[]
}

export function resolveDeterministicCommunicationRepairTarget({
  sourceAgentId,
  activeRouteCount,
  resultStatusIds,
  dashboardAgentIds,
  knownAgentIds,
}: CommunicationRepairInput) {
  if (activeRouteCount > 0 || resultStatusIds.length !== 1) return ''

  const knownIds = new Set(knownAgentIds)
  const candidates = [...new Set(dashboardAgentIds)].filter(
    (agentId) => agentId !== sourceAgentId && knownIds.has(agentId),
  )
  return candidates.length === 1 ? candidates[0] : ''
}

