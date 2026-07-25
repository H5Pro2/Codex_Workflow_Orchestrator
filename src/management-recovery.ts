type ManagementRecoveryInput = {
  isManagementAgent: boolean
  inboundSourceAgentId: string
  reportsTechnicalFailure: boolean
  configuredDeliveryCount: number
  knownAgentIds: string[]
}

type ManagementObservationInput = {
  isManagementAgent: boolean
  runPurpose: string
  inboundSourceAgentId: string
  reportsTechnicalFailure: boolean
  configuredDeliveryCount: number
  resultStatusCount: number
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

export function isCompletedManagementObservation({
  isManagementAgent,
  runPurpose,
  inboundSourceAgentId,
  reportsTechnicalFailure,
  configuredDeliveryCount,
  resultStatusCount,
}: ManagementObservationInput) {
  return (
    isManagementAgent &&
    runPurpose === 'monitoring' &&
    !inboundSourceAgentId &&
    !reportsTechnicalFailure &&
    configuredDeliveryCount === 0 &&
    resultStatusCount === 0
  )
}
