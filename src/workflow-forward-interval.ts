export const MAX_FORWARD_INTERVAL = 999

export function normalizeForwardInterval(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(MAX_FORWARD_INTERVAL, Math.max(0, Math.trunc(parsed)))
}

export function normalizeForwardIntervalCount(value: unknown, interval: unknown) {
  const normalizedInterval = normalizeForwardInterval(interval)
  if (normalizedInterval === 0) return 0
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(normalizedInterval - 1, Math.max(0, Math.trunc(parsed)))
}

export function nextForwardIntervalHit(interval: unknown, currentCount: unknown) {
  const normalizedInterval = normalizeForwardInterval(interval)
  if (normalizedInterval === 0) {
    return { branch: 'normal' as const, nextCount: 0 }
  }
  const nextCount = normalizeForwardIntervalCount(currentCount, normalizedInterval) + 1
  return nextCount >= normalizedInterval
    ? { branch: 'interval' as const, nextCount: 0 }
    : { branch: 'normal' as const, nextCount }
}
