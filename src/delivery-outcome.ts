export type DeliveryAttempt = {
  targetName: string
  delivered: boolean
}

export function summarizeDeliveryAttempts(attempts: DeliveryAttempt[]) {
  const deliveredTargets = attempts
    .filter((attempt) => attempt.delivered)
    .map((attempt) => attempt.targetName)

  return {
    deliveredTargets,
    delivered: deliveredTargets.length > 0,
    sourceStatus: deliveredTargets.length > 0 ? 'weitergegeben' : 'rueckfrage',
  } as const
}
