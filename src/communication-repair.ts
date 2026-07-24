type CommunicationRepairInput = {
  sourceAgentId: string
  sourceIsManagement: boolean
  activeRouteCount: number
  resultStatusIds: string[]
  dashboardAgentIds: string[]
  knownAgentIds: string[]
}

export function resolveDeterministicCommunicationRepairTarget({
  sourceAgentId,
  sourceIsManagement,
  activeRouteCount,
  resultStatusIds,
  dashboardAgentIds,
  knownAgentIds,
}: CommunicationRepairInput) {
  if (sourceIsManagement || activeRouteCount > 0 || resultStatusIds.length !== 1) return ''

  const knownIds = new Set(knownAgentIds)
  const candidates = [...new Set(dashboardAgentIds)].filter(
    (agentId) => agentId !== sourceAgentId && knownIds.has(agentId),
  )
  return candidates.length === 1 ? candidates[0] : ''
}
