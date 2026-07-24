type PendingTurnInput = {
  threadId: string
  pendingTurnId: string
  lastCompletedTurnId: string
  isAlreadyPolling: boolean
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
