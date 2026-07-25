export type DeliveryQueue = Record<string, string[]>

export function normalizeDeliveryQueue(value: unknown): DeliveryQueue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value)
      .filter(([targetId, sourceIds]) => targetId && Array.isArray(sourceIds))
      .map(([targetId, sourceIds]) => [
        targetId,
        Array.from(new Set(
          sourceIds.filter((sourceId: unknown): sourceId is string => typeof sourceId === 'string' && Boolean(sourceId)),
        )),
      ])
      .filter(([, sourceIds]) => sourceIds.length > 0),
  )
}

export function enqueueDelivery(
  queue: DeliveryQueue,
  targetId: string,
  sourceId: string,
) {
  const current = queue[targetId] ?? []
  if (!targetId || !sourceId || current.includes(sourceId)) return queue
  return { ...queue, [targetId]: [...current, sourceId] }
}

export function dequeueDelivery(queue: DeliveryQueue, targetId: string) {
  const [sourceId = '', ...remaining] = queue[targetId] ?? []
  if (!sourceId) return { sourceId: '', queue }
  const nextQueue = { ...queue }
  if (remaining.length > 0) nextQueue[targetId] = remaining
  else delete nextQueue[targetId]
  return { sourceId, queue: nextQueue }
}

export function removeDeliveryTarget(queue: DeliveryQueue, targetId: string) {
  if (!(targetId in queue)) return queue
  const nextQueue = { ...queue }
  delete nextQueue[targetId]
  return nextQueue
}
