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
  return routes
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
}
