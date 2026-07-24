type ManagementRecoveryInput = {
  isManagementAgent: boolean
  inboundSourceAgentId: string
  reportsTechnicalFailure: boolean
  configuredDeliveryCount: number
  knownAgentIds: string[]
}

type ManagementObservationInput = {
  isManagementAgent: boolean
  inboundSourceAgentId: string
  reportsTechnicalFailure: boolean
  configuredDeliveryCount: number
  resultStatusCount: number
}

type CommunicationEscalationInput = {
  inboundSourceAgentId: string
  configuredDeliveryCount: number
  hasDeterministicRepair: boolean
  projectManagerIds: string[]
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
  inboundSourceAgentId,
  reportsTechnicalFailure,
  configuredDeliveryCount,
  resultStatusCount,
}: ManagementObservationInput) {
  return (
    isManagementAgent &&
    !inboundSourceAgentId &&
    !reportsTechnicalFailure &&
    configuredDeliveryCount === 0 &&
    resultStatusCount === 0
  )
}

export function resolveCommunicationEscalationTargetId({
  inboundSourceAgentId,
  configuredDeliveryCount,
  hasDeterministicRepair,
  projectManagerIds,
}: CommunicationEscalationInput) {
  if (
    configuredDeliveryCount > 0 ||
    hasDeterministicRepair ||
    projectManagerIds.length !== 1
  ) {
    return ''
  }

  const managerId = projectManagerIds[0]
  return managerId === inboundSourceAgentId ? '' : managerId
}
