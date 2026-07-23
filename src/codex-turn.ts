export type ConversationMessage = {
  id?: string
  turnId: string
  role: 'user' | 'assistant'
  text: string
  phase: string
  turnStatus: string
}

export type ConversationTurnActivity = {
  turnId: string
  signature: string
  hasAssistantActivity: boolean
}

export function findConversationTurnActivity(
  messages: ConversationMessage[],
  submittedText: string,
  lastCompletedTurnId = '',
): ConversationTurnActivity | null {
  const normalizedSubmission = submittedText.trim()
  if (!normalizedSubmission) return null

  const turnId = messages.findLast(
    (message) =>
      message.role === 'user' &&
      message.turnId !== lastCompletedTurnId &&
      message.text.trim() === normalizedSubmission,
  )?.turnId
  if (!turnId) return null

  const turnMessages = messages.filter((message) => message.turnId === turnId)
  return {
    turnId,
    signature: JSON.stringify(
      turnMessages.map((message) => [
        message.id ?? '',
        message.role,
        message.phase,
        message.turnStatus,
        message.text,
      ]),
    ),
    hasAssistantActivity: turnMessages.some(
      (message) => message.role === 'assistant' && Boolean(message.text.trim()),
    ),
  }
}

export function findCompletedConversationTurn(
  messages: ConversationMessage[],
  submittedText: string,
  lastCompletedTurnId = '',
) {
  const normalizedSubmission = submittedText.trim()
  if (!normalizedSubmission) return null

  const matchingTurnIds = new Set(
    messages
      .filter(
        (message) =>
          message.role === 'user' &&
          message.turnId !== lastCompletedTurnId &&
          message.text.trim() === normalizedSubmission,
      )
      .map((message) => message.turnId),
  )

  return messages.findLast(
    (message) =>
      message.role === 'assistant' &&
      message.phase === 'final_answer' &&
      message.turnStatus === 'completed' &&
      matchingTurnIds.has(message.turnId) &&
      Boolean(message.text.trim()),
  ) ?? null
}
