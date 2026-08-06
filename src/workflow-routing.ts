import { forwardIntervalSourceHandles, nextForwardIntervalHit } from './workflow-forward-interval.ts'

export type WorkflowRouteLike = {
  id: string
  sourceId: string
  targetId: string
  condition: string
  prompt: string
  sourceHandle?: string
  [key: string]: unknown
}

export type WorkflowPromptLike = {
  id: string
  condition: string
  prompt: string
  interval?: number
  intervalCount?: number
  intervalMode?: string
  intervalPrompt?: string
}

export type WorkflowStatusFilterLike = {
  id: string
  statusId: string
  interval?: number
  intervalCount?: number
  intervalMode?: string
  intervalPrompt?: string
}

export type WorkflowLoopLike = {
  id: string
  targetAgentId: string
  targetAgentIds?: readonly string[]
}

export type ResolvedWorkflowDelivery = {
  route: WorkflowRouteLike
  targetId?: string
  stopId?: string
  promptNodeId?: string
  loopNodeId?: string
  promptBranch?: 'normal' | 'interval'
  promptNextCount?: number
}

export function routeConditionMatches(_condition: string, _result: string) {
  return true
}

export function isTerminalIntervalSideBranch({
  agentId,
  activeRouteCount,
  routes,
}: {
  agentId: string
  activeRouteCount: number
  routes: readonly WorkflowRouteLike[]
}) {
  if (activeRouteCount > 0) return false
  return routes.some((route) =>
    route.targetId === agentId &&
    (route.sourceHandle || 'output') === 'interval',
  )
}

export function resolveConfiguredDeliveries({
  sourceId,
  result,
  routes,
  promptNodes,
  loopNodes = [],
  targetIds,
  stopIds,
}: {
  sourceId: string
  result: string
  routes: readonly WorkflowRouteLike[]
  resultStatusIds?: readonly string[]
  statusFilters?: readonly WorkflowStatusFilterLike[]
  promptNodes: readonly WorkflowPromptLike[]
  loopNodes?: readonly WorkflowLoopLike[]
  targetIds: ReadonlySet<string>
  stopIds: ReadonlySet<string>
}) {
  const resolveRouteTarget = (
    route: WorkflowRouteLike,
    metadata: Partial<ResolvedWorkflowDelivery> = {},
    visitedLoopIds = new Set<string>(),
  ): ResolvedWorkflowDelivery[] => {
    if (targetIds.has(route.targetId)) return [{ targetId: route.targetId, route, ...metadata }]
    if (stopIds.has(route.targetId)) return [{ stopId: route.targetId, route, ...metadata }]
    const loopNode = loopNodes.find((loop) => loop.id === route.targetId)
    const loopTargetIds = loopNode
      ? [...new Set([...(loopNode.targetAgentIds ?? []), loopNode.targetAgentId].filter(Boolean))]
      : []
    if (loopNode && !visitedLoopIds.has(loopNode.id)) {
      const nextVisitedLoopIds = new Set([...visitedLoopIds, loopNode.id])
      const loopDeliveries = loopTargetIds
        .filter((targetId) => targetIds.has(targetId))
        .map((targetId) => ({ targetId, route, loopNodeId: loopNode!.id, ...metadata }))
      const outgoingDeliveries = routes
        .filter((outgoing) =>
          outgoing.sourceId === loopNode.id &&
          (outgoing.sourceHandle || 'output') === 'output' &&
          routeConditionMatches(outgoing.condition, result),
        )
        .flatMap((outgoing) => resolveRouteTarget(
          outgoing,
          { loopNodeId: loopNode.id, ...metadata },
          nextVisitedLoopIds,
        ))
      return [...loopDeliveries, ...outgoingDeliveries]
    }
    const promptNode = promptNodes.find((prompt) => prompt.id === route.targetId)
    if (promptNode) {
      const intervalHit = nextForwardIntervalHit(promptNode.interval, promptNode.intervalCount)
      const expectedHandles = new Set(forwardIntervalSourceHandles(intervalHit.branch, promptNode.intervalMode))
      return routes
        .filter(
          (outgoing) =>
            outgoing.sourceId === promptNode.id &&
            expectedHandles.has((outgoing.sourceHandle || 'output') as 'output' | 'interval') &&
            routeConditionMatches(outgoing.condition, result),
        )
        .flatMap<ResolvedWorkflowDelivery>((outgoing) => {
          const resolvedRoute = {
            ...outgoing,
            condition: promptNode.condition,
            prompt: (outgoing.sourceHandle || 'output') === 'interval'
              ? (promptNode.intervalPrompt ?? promptNode.prompt)
              : promptNode.prompt,
          }
          return resolveRouteTarget(
            resolvedRoute,
            {
              ...metadata,
              promptNodeId: promptNode.id,
              promptBranch: intervalHit.branch,
              promptNextCount: intervalHit.nextCount,
            },
            visitedLoopIds,
          )
        })
    }
    return []
  }

  const deliveries = routes
    .filter((route) => route.sourceId === sourceId)
    .flatMap<ResolvedWorkflowDelivery>((route) => {
      const directDelivery = resolveRouteTarget(route)
      if (directDelivery.length > 0) return directDelivery
      const promptNode = promptNodes.find((prompt) => prompt.id === route.targetId)
      if (!promptNode) return []
      const intervalHit = nextForwardIntervalHit(promptNode.interval, promptNode.intervalCount)
      const expectedHandles = new Set(forwardIntervalSourceHandles(intervalHit.branch, promptNode.intervalMode))
      return routes
        .filter(
          (outgoing) =>
            outgoing.sourceId === promptNode.id &&
            expectedHandles.has((outgoing.sourceHandle || 'output') as 'output' | 'interval') &&
            routeConditionMatches(outgoing.condition, result),
        )
        .flatMap<ResolvedWorkflowDelivery>((outgoing) => {
          const resolvedRoute = {
            ...outgoing,
            condition: promptNode.condition,
            prompt: (outgoing.sourceHandle || 'output') === 'interval'
              ? (promptNode.intervalPrompt ?? promptNode.prompt)
              : promptNode.prompt,
          }
          const intervalMetadata = {
            promptNodeId: promptNode.id,
            promptBranch: intervalHit.branch,
            promptNextCount: intervalHit.nextCount,
          }
          return resolveRouteTarget(resolvedRoute, intervalMetadata)
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
