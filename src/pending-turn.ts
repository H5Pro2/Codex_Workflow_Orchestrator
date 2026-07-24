type PendingTurnInput = {
  threadId: string
  pendingTurnId: string
  lastCompletedTurnId: string
  isAlreadyPolling: boolean
}

type AgentWorkingInput = {
  status: string
  pendingTurnId: string
  isTransmitting: boolean
}

export function isAgentWorking({
  status,
  pendingTurnId,
  isTransmitting,
}: AgentWorkingInput) {
  return isTransmitting || (status === 'laeuft' && Boolean(pendingTurnId))
}

export function shouldPollPendingTurn({
  threadId,
  pendingTurnId,
  lastCompletedTurnId,
  isAlreadyPolling,
}: PendingTurnInput) {
  return Boolean(
    threadId &&
    pendingTurnId &&
    pendingTurnId !== lastCompletedTurnId &&
    !isAlreadyPolling,
  )
}

type StableTerminalResultInput = {
  runStartedAt: string
  observations: number
  now: number
}

export function resolvePendingTurnStartedAt(
  runStartedAt: string,
  agentUpdatedAt: string,
) {
  const candidates = [runStartedAt, agentUpdatedAt]

  for (const candidate of candidates) {
    if (!candidate) continue
    const timestamp = new Date(candidate).getTime()
    if (Number.isFinite(timestamp)) return timestamp
  }

  return 0
}

export function hasStableTerminalResult({
  runStartedAt,
  observations,
  now,
}: StableTerminalResultInput) {
  if (observations < 2) return false
  if (!runStartedAt) return true

  const startedAt = new Date(runStartedAt).getTime()
  return !Number.isFinite(startedAt) || now - startedAt >= 6000
}
