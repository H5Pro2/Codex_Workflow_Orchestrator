export function workflowDeliveryKey({
  sourceId,
  sourceTurnId = '',
  routeId = '',
  sourceNodeId = '',
  targetId,
  mode = 'read',
  statusIds,
  taskSignature = '',
}: {
  sourceId: string
  sourceTurnId?: string
  routeId?: string
  sourceNodeId?: string
  targetId: string
  mode?: 'read' | 'stop'
  statusIds: readonly string[]
  taskSignature?: string
}) {
  const statusKey = [...statusIds].sort().join(',')
  return [
    `source:${sourceId}`,
    `turn:${sourceTurnId}`,
    `node:${sourceNodeId}`,
    `route:${routeId}`,
    `target:${targetId}`,
    `mode:${mode}`,
    `status:${statusKey}`,
    `task:${taskSignature}`,
  ].join('|')
}

export function wouldRepeatWorkflowCycle(
  recentDeliveryKeys: readonly string[],
  nextDeliveryKey: string,
) {
  if (!nextDeliveryKey) return false
  const sequence = [...recentDeliveryKeys, nextDeliveryKey]
  const maxCycleLength = Math.min(6, Math.floor((sequence.length - 1) / 2))

  for (let cycleLength = 1; cycleLength <= maxCycleLength; cycleLength += 1) {
    const cycleStart = sequence.length - (cycleLength * 2) - 1
    if (cycleStart < 0) continue
    const firstCycle = sequence.slice(cycleStart, cycleStart + cycleLength)
    const secondCycle = sequence.slice(cycleStart + cycleLength, cycleStart + (cycleLength * 2))
    if (
      firstCycle.every((key, index) => key === secondCycle[index]) &&
      nextDeliveryKey === firstCycle[0]
    ) {
      return true
    }
  }
  return false
}
