export const DEFAULT_CONVERSATION_MESSAGE_LIMIT = 120
export const MAX_CONVERSATION_MESSAGE_LIMIT = 500

export function conversationMessageLimit(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CONVERSATION_MESSAGE_LIMIT
  return Math.min(parsed, MAX_CONVERSATION_MESSAGE_LIMIT)
}

export function selectConversationWindow(messages, requestedLimit) {
  const limit = conversationMessageLimit(requestedLimit)
  return Array.isArray(messages) ? messages.slice(-limit) : []
}
