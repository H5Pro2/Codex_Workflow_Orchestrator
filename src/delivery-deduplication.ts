export function deliveryDeduplicationSignature(
  taskSignature: string,
  completedTurnId: string,
  reportEveryTurn: boolean,
) {
  if (!taskSignature) return ''
  if (!reportEveryTurn || !completedTurnId) return taskSignature
  return `${taskSignature}::turn:${completedTurnId}`
}

export function shouldDeliverWorkflowTask({
  currentSignature,
  lastForwardedSignature,
  replayCheckpoint = false,
}: {
  currentSignature: string
  lastForwardedSignature?: string
  replayCheckpoint?: boolean
}) {
  return replayCheckpoint || !currentSignature || lastForwardedSignature !== currentSignature
}

export function isWorkflowSourceTurnReady({
  pendingTurnId,
  lastCompletedTurnId,
}: {
  pendingTurnId?: string
  lastCompletedTurnId?: string
}) {
  return Boolean(lastCompletedTurnId) && !pendingTurnId
}
