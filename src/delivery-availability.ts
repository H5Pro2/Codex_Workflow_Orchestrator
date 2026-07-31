type DeliveryAgentState = {
  id: string
  status: string
  pendingTurnId: string
  pendingUserConfirmation?: unknown
}

type DeliveryAvailabilityInput = {
  targetId: string
  activeTargetIds: ReadonlySet<string>
  agents: DeliveryAgentState[]
}

export function isDeliveryTargetBusy({
  targetId,
  activeTargetIds,
  agents,
}: DeliveryAvailabilityInput) {
  if (activeTargetIds.has(targetId)) return true
  const currentTarget = agents.find((agent) => agent.id === targetId)
  return (
    Boolean(currentTarget?.pendingTurnId) ||
    Boolean(currentTarget?.pendingUserConfirmation) ||
    currentTarget?.status === 'laeuft'
  )
}
