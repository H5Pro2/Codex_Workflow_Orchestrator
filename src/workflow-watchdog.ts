export const TURN_INACTIVITY_TIMEOUT_MS = 10 * 60 * 1000
export const TURN_MAX_RUNTIME_MS = 45 * 60 * 1000

export type TurnActivityObservation = {
  turnId: string
  signature: string
  lastActivityAt: number
}

export function observeTurnActivity(
  previous: TurnActivityObservation | undefined,
  turnId: string,
  signature: string,
  now: number,
): TurnActivityObservation {
  if (!previous || previous.turnId !== turnId || previous.signature !== signature) {
    return { turnId, signature, lastActivityAt: now }
  }
  return previous
}

export function turnNeedsWatchdogIntervention(
  observation: TurnActivityObservation,
  runStartedAt: number,
  now: number,
) {
  if (!Number.isFinite(runStartedAt) || runStartedAt <= 0) return false
  return (
    now - observation.lastActivityAt >= TURN_INACTIVITY_TIMEOUT_MS ||
    now - runStartedAt >= TURN_MAX_RUNTIME_MS
  )
}
