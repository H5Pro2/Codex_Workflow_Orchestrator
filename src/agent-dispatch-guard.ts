export type DispatchableAgent = {
  id: string
  status: string
  pendingTurnId: string
  pendingUserConfirmation?: unknown
}

export function reserveAgentDispatch(
  activeAgentIds: Set<string>,
  agent: DispatchableAgent,
) {
  if (
    agent.status === 'laeuft' ||
    Boolean(agent.pendingTurnId) ||
    Boolean(agent.pendingUserConfirmation) ||
    activeAgentIds.has(agent.id)
  ) {
    return false
  }
  activeAgentIds.add(agent.id)
  return true
}

export function releaseAgentDispatch(activeAgentIds: Set<string>, agentId: string) {
  activeAgentIds.delete(agentId)
}
