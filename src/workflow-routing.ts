export type WorkflowRouteLike = {
  id: string
  sourceId: string
  targetId: string
  condition: string
  prompt: string
  [key: string]: unknown
}

export type WorkflowStatusFilterLike = {
  id: string
  statusId: string
}

export type WorkflowPromptLike = {
  id: string
  condition: string
  prompt: string
}

export type ResolvedWorkflowDelivery = {
  route: WorkflowRouteLike
  targetId?: string
  stopId?: string
}

export function resolveUnconditionalForwarding({
  sourceId,
  statusId,
  routes,
  statusFilters,
  targetIds,
}: {
  sourceId: string
  statusId: string
  routes: readonly WorkflowRouteLike[]
  statusFilters: readonly WorkflowStatusFilterLike[]
  targetIds: ReadonlySet<string>
}) {
  const filterIds = new Set(
    statusFilters.filter((filter) => filter.statusId === statusId).map((filter) => filter.id),
  )
  const connectedFilterIds = new Set(
    routes
      .filter((route) => route.sourceId === sourceId && filterIds.has(route.targetId))
      .map((route) => route.targetId),
  )
  if (connectedFilterIds.size === 0) {
    return { enabled: false, delivery: null, issue: '' }
  }
  const deliveries = routes
    .filter((route) => connectedFilterIds.has(route.sourceId) && targetIds.has(route.targetId))
    .map((route) => ({ targetId: route.targetId, stopId: undefined, route }))
  if (connectedFilterIds.size !== 1 || deliveries.length !== 1) {
    return {
      enabled: true,
      delivery: null,
      issue: 'Der feste Status „Weiterleiten“ muss mit genau einem Zielagenten verbunden sein.',
    }
  }
  return { enabled: true, delivery: deliveries[0], issue: '' }
}

export function wouldCreateUnsupportedUnconditionalForwardCycle({
  sourceAgentId,
  targetAgentId,
  statusId,
  routes,
  statusFilters,
}: {
  sourceAgentId: string
  targetAgentId: string
  statusId: string
  routes: readonly WorkflowRouteLike[]
  statusFilters: readonly (WorkflowStatusFilterLike & { ownerAgentId?: string })[]
}) {
  const forwardFilters = statusFilters.filter((filter) => filter.statusId === statusId)
  const adjacency = new Map<string, Set<string>>()
  forwardFilters.forEach((filter) => {
    const ownerId = filter.ownerAgentId
    if (!ownerId) return
    const connectedFromOwner = routes.some((route) =>
      route.sourceId === ownerId && route.targetId === filter.id,
    )
    if (!connectedFromOwner) return
    routes.filter((route) => route.sourceId === filter.id).forEach((route) => {
      adjacency.set(ownerId, new Set([...(adjacency.get(ownerId) ?? []), route.targetId]))
    })
  })
  adjacency.set(
    sourceAgentId,
    new Set([...(adjacency.get(sourceAgentId) ?? []), targetAgentId]),
  )
  const pending = [{ agentId: targetAgentId, distance: 0 }]
  const visited = new Set<string>()
  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || visited.has(current.agentId)) continue
    if (current.agentId === sourceAgentId) {
      return current.distance !== 1
    }
    visited.add(current.agentId)
    pending.push(...[...(adjacency.get(current.agentId) ?? [])].map((agentId) => ({
      agentId,
      distance: current.distance + 1,
    })))
  }
  return false
}

export function routeConditionMatches(condition: string, result: string) {
  const normalized = condition.trim().toLocaleLowerCase('de-DE')
  return (
    normalized === '' ||
    normalized === 'immer' ||
    result.toLocaleLowerCase('de-DE').includes(normalized)
  )
}

export function resolveConfiguredDeliveries({
  sourceId,
  result,
  resultStatusIds,
  routes,
  statusFilters,
  promptNodes,
  targetIds,
  stopIds,
}: {
  sourceId: string
  result: string
  resultStatusIds: readonly string[]
  routes: readonly WorkflowRouteLike[]
  statusFilters: readonly WorkflowStatusFilterLike[]
  promptNodes: readonly WorkflowPromptLike[]
  targetIds: ReadonlySet<string>
  stopIds: ReadonlySet<string>
}) {
  const deliveries = routes
    .filter((route) => route.sourceId === sourceId)
    .flatMap<ResolvedWorkflowDelivery>((route) => {
      if (targetIds.has(route.targetId)) return [{ targetId: route.targetId, route }]
      if (stopIds.has(route.targetId)) return [{ stopId: route.targetId, route }]

      const statusFilter = statusFilters.find((filter) => filter.id === route.targetId)
      if (statusFilter) {
        if (!resultStatusIds.includes(statusFilter.statusId)) return []
        return routes
          .filter((outgoing) => outgoing.sourceId === statusFilter.id)
          .flatMap<ResolvedWorkflowDelivery>((outgoing) => {
            if (targetIds.has(outgoing.targetId)) return [{ targetId: outgoing.targetId, route: outgoing }]
            if (stopIds.has(outgoing.targetId)) return [{ stopId: outgoing.targetId, route: outgoing }]
            return []
          })
      }

      const promptNode = promptNodes.find((prompt) => prompt.id === route.targetId)
      if (!promptNode) return []
      return routes
        .filter(
          (outgoing) =>
            outgoing.sourceId === promptNode.id &&
            routeConditionMatches(outgoing.condition, result),
        )
        .flatMap<ResolvedWorkflowDelivery>((outgoing) => {
          const resolvedRoute = {
            ...outgoing,
            condition: promptNode.condition,
            prompt: promptNode.prompt,
          }
          if (targetIds.has(outgoing.targetId)) return [{ targetId: outgoing.targetId, route: resolvedRoute }]
          if (stopIds.has(outgoing.targetId)) return [{ stopId: outgoing.targetId, route: resolvedRoute }]
          return []
        })
    })

  const seenTargets = new Set<string>()
  return deliveries.filter((delivery) => {
    const key = delivery.targetId
      ? `target:${delivery.targetId}`
      : `stop:${delivery.stopId ?? ''}`
    if (seenTargets.has(key)) return false
    seenTargets.add(key)
    return true
  })
}
