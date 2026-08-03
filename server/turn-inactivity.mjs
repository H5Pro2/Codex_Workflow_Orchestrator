export const INACTIVE_TURN_CONFIRMATION_MS = 60_000

export function confirmInactiveTurn({
  observations,
  key,
  inactive,
  now = Date.now(),
  confirmationMs = INACTIVE_TURN_CONFIRMATION_MS,
}) {
  if (!key) return false
  if (!inactive) {
    observations.delete(key)
    return false
  }

  const firstInactiveAt = observations.get(key) ?? now
  observations.set(key, firstInactiveAt)
  return now - firstInactiveAt >= confirmationMs
}
