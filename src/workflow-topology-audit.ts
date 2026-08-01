type AuditAgent = {
  id: string
  name: string
  assignment: 'management' | 'agent'
}

type AuditStatus = {
  id: string
}

type AuditFilter = {
  id: string
  ownerAgentId: string
  statusId: string
}

type AuditRoute = {
  ownerAgentId: string
  sourceId: string
  targetId: string
  sourceHandle?: string
}

type AuditForwardingNode = {
  id: string
  ownerAgentId: string
  interval?: number
}

type AuditTerminal = {
  id: string
  ownerAgentId: string
}

export type WorkflowTopologyIssue = {
  agentId: string
  code: 'missing-status' | 'unknown-status' | 'unreachable-status' | 'missing-target' | 'dangling-route'
  detail: string
}

export function auditWorkflowTopology({
  agents,
  activeAgentIds,
  statuses,
  filters,
  routes,
  terminals,
  forwardingNodes = [],
}: {
  agents: readonly AuditAgent[]
  activeAgentIds: ReadonlySet<string>
  statuses: readonly AuditStatus[]
  filters: readonly AuditFilter[]
  routes: readonly AuditRoute[]
  terminals: readonly AuditTerminal[]
  forwardingNodes?: readonly AuditForwardingNode[]
}) {
  const issues: WorkflowTopologyIssue[] = []
  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const statusIds = new Set(statuses.map((status) => status.id))
  const filterById = new Map(filters.map((filter) => [filter.id, filter]))
  const terminalIds = new Set(terminals.map((terminal) => terminal.id))
  const knownNodeIds = new Set([...agentById.keys(), ...filterById.keys(), ...terminalIds])

  agents.filter((agent) => activeAgentIds.has(agent.id)).forEach((agent) => {
    const ownedFilters = filters.filter((filter) => filter.ownerAgentId === agent.id)
    if (ownedFilters.length === 0) {
      issues.push({
        agentId: agent.id,
        code: 'missing-status',
        detail: `${agent.name}: Im Dashboard ist kein fachlicher Status konfiguriert.`,
      })
      return
    }

    ownedFilters.forEach((filter) => {
      if (!statusIds.has(filter.statusId)) {
        issues.push({
          agentId: agent.id,
          code: 'unknown-status',
          detail: `${agent.name}: Ein Statusbaustein verweist auf einen nicht vorhandenen Status.`,
        })
      }
      if (!routes.some((route) =>
        route.ownerAgentId === agent.id && route.sourceId === agent.id && route.targetId === filter.id,
      )) {
        issues.push({
          agentId: agent.id,
          code: 'unreachable-status',
          detail: `${agent.name}: Der Statusbaustein ist nicht mit dem Ausgang des Agenten verbunden.`,
        })
      }
      if (!routes.some((route) => route.ownerAgentId === agent.id && route.sourceId === filter.id)) {
        issues.push({
          agentId: agent.id,
          code: 'missing-target',
          detail: `${agent.name}: Der Statusbaustein besitzt keine Verbindung zu einem Zielagenten oder Stopp.`,
        })
      }
    })
  })

  forwardingNodes.forEach((node) => {
    if (!activeAgentIds.has(node.ownerAgentId) || !node.interval) return
    const owner = agentById.get(node.ownerAgentId)
    if (!owner) return
    const outgoingHandles = new Set(
      routes
        .filter((route) => route.ownerAgentId === node.ownerAgentId && route.sourceId === node.id)
        .map((route) => route.sourceHandle || 'output'),
    )
    if (!outgoingHandles.has('output')) {
      issues.push({
        agentId: node.ownerAgentId,
        code: 'missing-target',
        detail: `${owner.name}: Ein Weiterleiten-Intervall besitzt keinen normalen Ausgang.`,
      })
    }
    if (!outgoingHandles.has('interval')) {
      issues.push({
        agentId: node.ownerAgentId,
        code: 'missing-target',
        detail: `${owner.name}: Ein Weiterleiten-Intervall besitzt keinen Intervall-Ausgang.`,
      })
    }
  })

  routes.forEach((route) => {
    const owner = agentById.get(route.ownerAgentId)
    if (!owner || !activeAgentIds.has(route.ownerAgentId)) return
    if (!knownNodeIds.has(route.sourceId) || !knownNodeIds.has(route.targetId)) {
      issues.push({
        agentId: route.ownerAgentId,
        code: 'dangling-route',
        detail: `${owner.name}: Eine Dashboard-Verbindung verweist auf einen nicht vorhandenen Baustein.`,
      })
    }
  })

  return issues.filter((issue, index) =>
    issues.findIndex((candidate) =>
      candidate.agentId === issue.agentId &&
      candidate.code === issue.code &&
      candidate.detail === issue.detail,
    ) === index,
  )
}
