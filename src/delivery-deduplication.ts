export function deliveryDeduplicationSignature(
  taskSignature: string,
  completedTurnId: string,
  reportEveryTurn: boolean,
) {
  if (!taskSignature) return ''
  if (!reportEveryTurn || !completedTurnId) return taskSignature
  return `${taskSignature}::turn:${completedTurnId}`
}
