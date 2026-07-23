export type ConversationMessage = {
  turnId: string
  role: 'user' | 'assistant'
  text: string
  phase: string
  turnStatus: string
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
