type ManagementRecoveryInput = {
  isManagementAgent: boolean
  inboundSourceAgentId: string
  reportsTechnicalFailure: boolean
  configuredDeliveryCount: number
  knownAgentIds: string[]
}

export function resolveManagementRecoveryTargetId({
  isManagementAgent,
  inboundSourceAgentId,
  reportsTechnicalFailure,
  configuredDeliveryCount,
  knownAgentIds,
}: ManagementRecoveryInput) {
  if (
    !isManagementAgent ||
    !inboundSourceAgentId ||
    reportsTechnicalFailure ||
    configuredDeliveryCount > 0 ||
    !knownAgentIds.includes(inboundSourceAgentId)
  ) {
    return ''
  }

  return inboundSourceAgentId
}
