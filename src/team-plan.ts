export const MANAGEMENT_ERROR_STATUS_NAME = 'Fehler'
export const MANAGEMENT_ERROR_STATUS_MEANING =
  'Der Agent konnte seinen Codex-Lauf nicht abschließen und benötigt eine Entscheidung oder neue Anweisung.'

export type ManagementTeamPlanAgent = {
  name: string
  role: string
  prompt: string
  workflowStatuses: string[]
}

export type ManagementTeamPlanConnection = {
  from: string
  to: string
  status: string
}

export type ManagementTeamPlanStatusCommand = {
  name: string
  meaning: string
}

export type ManagementTeamPlanStop = {
  from: string
  status: string
  name: string
}

export type ManagementTeamPlan = {
  projectGoal: string
  startAgent: string
  startInstruction: string
  statusCommands: ManagementTeamPlanStatusCommand[]
  agents: ManagementTeamPlanAgent[]
  connections: ManagementTeamPlanConnection[]
  stops: ManagementTeamPlanStop[]
}

export type TeamAgentRef = { id: string; name: string }
export type TeamStatus = { id: string; projectPath: string; name: string; description: string }
export type TeamInitial = { id: string; ownerAgentId: string; projectPath: string; name: string; instruction: string }
export type TeamStatusFilter = { id: string; ownerAgentId: string; projectPath: string; name: string; statusId: string }
export type TeamStop = { id: string; ownerAgentId: string; projectPath: string; name: string }
export type TeamRoute = {
  id: string
  ownerAgentId: string
  projectPath: string
  sourceId: string
  targetId: string
  condition: string
  prompt: string
  lastForwardedTask?: string
}

function normalizedName(value: string) {
  return value.trim().toLocaleLowerCase('de-DE')
}

function samePath(left: string, right: string) {
  return left.replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE') ===
    right.replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE')
}

export function parseManagementTeamPlan(text: string): { plan: ManagementTeamPlan; signature: string } | null {
  const match = text.match(/<orchestrator_team_plan>\s*([\s\S]*?)\s*<\/orchestrator_team_plan>/i)
  if (!match) return null

  try {
    const raw = JSON.parse(match[1]) as Record<string, unknown>
    if (!Array.isArray(raw.agents) || raw.agents.length === 0 || raw.agents.length > 12) return null
    const agents = raw.agents.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new Error('invalid agent')
      const item = entry as Record<string, unknown>
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      const role = typeof item.role === 'string' ? item.role.trim() : ''
      const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : ''
      if (!name || !role || !prompt || name.length > 80) throw new Error('invalid agent')
      return {
        name,
        role,
        prompt,
        workflowStatuses: Array.isArray(item.workflowStatuses)
          ? item.workflowStatuses.filter((status): status is string => typeof status === 'string').map((status) => status.trim()).filter(Boolean)
          : [],
      }
    })
    const normalizedNames = agents.map((agent) => normalizedName(agent.name))
    if (new Set(normalizedNames).size !== normalizedNames.length) return null

    const statusCommands = Array.isArray(raw.statusCommands)
      ? raw.statusCommands.map((entry) => {
          if (!entry || typeof entry !== 'object') throw new Error('invalid status command')
          const item = entry as Record<string, unknown>
          const name = typeof item.name === 'string' ? item.name.trim() : ''
          const meaning = typeof item.meaning === 'string' ? item.meaning.trim() : ''
          if (!name || !meaning || name.length > 80 || meaning.length > 500) throw new Error('invalid status command')
          return { name, meaning }
        })
      : []
    if (statusCommands.length > 20) return null
    if (!statusCommands.some((status) => normalizedName(status.name) === normalizedName(MANAGEMENT_ERROR_STATUS_NAME))) {
      statusCommands.push({ name: MANAGEMENT_ERROR_STATUS_NAME, meaning: MANAGEMENT_ERROR_STATUS_MEANING })
    }
    agents.forEach((agent) => {
      if (!agent.workflowStatuses.some((status) => normalizedName(status) === normalizedName(MANAGEMENT_ERROR_STATUS_NAME))) {
        agent.workflowStatuses.push(MANAGEMENT_ERROR_STATUS_NAME)
      }
    })
    if (statusCommands.length > 20) return null
    const normalizedStatusNames = statusCommands.map((status) => normalizedName(status.name))
    if (new Set(normalizedStatusNames).size !== normalizedStatusNames.length) return null

    const fallbackStatus = statusCommands[0]?.name ?? ''
    const connections = Array.isArray(raw.connections)
      ? raw.connections.map((entry) => {
          if (!entry || typeof entry !== 'object') throw new Error('invalid connection')
          const item = entry as Record<string, unknown>
          const from = typeof item.from === 'string' ? item.from.trim() : ''
          const to = typeof item.to === 'string' ? item.to.trim() : ''
          const sourceAgent = agents.find((agent) => normalizedName(agent.name) === normalizedName(from))
          const status = typeof item.status === 'string' && item.status.trim()
            ? item.status.trim()
            : sourceAgent?.workflowStatuses[0] ?? fallbackStatus
          if (!from || !to || normalizedName(from) === normalizedName(to)) throw new Error('invalid connection')
          if (!normalizedNames.includes(normalizedName(from)) || !normalizedNames.includes(normalizedName(to))) {
            throw new Error('unknown connection agent')
          }
          if (!status || !normalizedStatusNames.includes(normalizedName(status))) throw new Error('invalid connection status')
          return { from, to, status }
        })
      : []
    const stops = Array.isArray(raw.stops)
      ? raw.stops.map((entry) => {
          if (!entry || typeof entry !== 'object') throw new Error('invalid stop')
          const item = entry as Record<string, unknown>
          const from = typeof item.from === 'string' ? item.from.trim() : ''
          const status = typeof item.status === 'string' ? item.status.trim() : ''
          const name = typeof item.name === 'string' ? item.name.trim() : ''
          if (!from || !status || !name || name.length > 80) throw new Error('invalid stop')
          if (!normalizedNames.includes(normalizedName(from))) throw new Error('unknown stop agent')
          if (!normalizedStatusNames.includes(normalizedName(status))) throw new Error('invalid stop status')
          return { from, status, name }
        })
      : []
    if (stops.length > 12) return null
    ;[...connections, ...stops].forEach((path) => {
      const source = agents.find((agent) => normalizedName(agent.name) === normalizedName(path.from))
      if (source && !source.workflowStatuses.some((status) => normalizedName(status) === normalizedName(path.status))) {
        source.workflowStatuses.push(path.status)
      }
    })
    const projectGoal = typeof raw.projectGoal === 'string' ? raw.projectGoal.trim() : ''
    const requestedStartAgent = typeof raw.startAgent === 'string' ? raw.startAgent.trim() : ''
    const startAgent = agents.find((agent) => normalizedName(agent.name) === normalizedName(requestedStartAgent))?.name ?? agents[0].name
    const startInstruction = typeof raw.startInstruction === 'string' && raw.startInstruction.trim()
      ? raw.startInstruction.trim()
      : `Beginne mit der dir zugewiesenen Arbeit für dieses Projektziel: ${projectGoal || 'Setze den beschriebenen Teamauftrag um.'}`
    const plan = { projectGoal, startAgent, startInstruction, statusCommands, agents, connections, stops }
    return { plan, signature: JSON.stringify(plan) }
  } catch {
    return null
  }
}

type TeamTopologyInput = {
  plan: ManagementTeamPlan
  manager: TeamAgentRef
  agents: TeamAgentRef[]
  projectPath: string
  statuses: TeamStatus[]
  initials: TeamInitial[]
  filters: TeamStatusFilter[]
  stops: TeamStop[]
  routes: TeamRoute[]
  positions: Record<string, { x: number; y: number }>
  boardAgentIds: Record<string, string[]>
  createId: () => string
}

export function buildTeamTopology(input: TeamTopologyInput) {
  const { plan, manager, projectPath, createId } = input
  const agentByName = new Map(input.agents.map((agent) => [normalizedName(agent.name), agent]))
  const statusByName = new Map(
    input.statuses
      .filter((status) => samePath(status.projectPath, projectPath))
      .map((status) => [normalizedName(status.name), status]),
  )
  const managedAgents = plan.agents.map((item) => {
    const agent = agentByName.get(normalizedName(item.name))
    if (!agent) throw new Error(`Agent fehlt: ${item.name}`)
    return agent
  })
  const startAgent = agentByName.get(normalizedName(plan.startAgent))
  if (!startAgent) throw new Error(`Start-Agent fehlt: ${plan.startAgent}`)

  const existingInitial = input.initials.find((item) => item.ownerAgentId === manager.id && item.name === 'Team-Start')
  const configuredInitial = {
    id: existingInitial?.id ?? createId(), ownerAgentId: manager.id, projectPath,
    name: 'Team-Start', instruction: plan.startInstruction,
  }
  const planFilters = plan.connections.map((connection) => {
    const status = statusByName.get(normalizedName(connection.status))
    const source = agentByName.get(normalizedName(connection.from))
    if (!status || !source) throw new Error(`Ungültige Verbindung: ${connection.from} / ${connection.status}`)
    const name = `${connection.status}: ${connection.from} → ${connection.to}`
    const existing = input.filters.find((item) => samePath(item.projectPath, projectPath) && item.name === name)
    return { id: existing?.id ?? createId(), ownerAgentId: source.id, projectPath, name, statusId: status.id }
  })
  const errorStatus = statusByName.get(normalizedName(MANAGEMENT_ERROR_STATUS_NAME))
  if (!errorStatus) throw new Error(`Statusbefehl fehlt: ${MANAGEMENT_ERROR_STATUS_NAME}`)
  const errorFilters = managedAgents.map((source) => {
    const name = `${MANAGEMENT_ERROR_STATUS_NAME}: ${source.name} -> ${manager.name}`
    const existing = input.filters.find((item) => samePath(item.projectPath, projectPath) && item.name === name)
    return { id: existing?.id ?? createId(), ownerAgentId: source.id, projectPath, name, statusId: errorStatus.id }
  })
  const planStops = plan.stops.map((item) => {
    const source = agentByName.get(normalizedName(item.from))
    if (!source) throw new Error(`Agent fehlt: ${item.from}`)
    const existing = input.stops.find((stop) => stop.ownerAgentId === source.id && samePath(stop.projectPath, projectPath) && stop.name === item.name)
    return { id: existing?.id ?? createId(), ownerAgentId: source.id, projectPath, name: item.name }
  })
  const stopFilters = plan.stops.map((item, index) => {
    const source = agentByName.get(normalizedName(item.from))
    const status = statusByName.get(normalizedName(item.status))
    if (!source || !status) throw new Error(`Ungültiger Abschlussweg: ${item.from} / ${item.status}`)
    const name = `${item.status}: ${item.from} -> ${item.name}`
    const existing = input.filters.find((filter) => filter.ownerAgentId === source.id && samePath(filter.projectPath, projectPath) && filter.name === name)
    return { id: existing?.id ?? createId(), ownerAgentId: source.id, projectPath, name, statusId: status.id, stopId: planStops[index].id }
  })
  const newRoutes: TeamRoute[] = [
    { id: createId(), ownerAgentId: manager.id, projectPath, sourceId: configuredInitial.id, targetId: startAgent.id, condition: 'Immer', prompt: plan.startInstruction },
    ...plan.connections.flatMap((connection, index) => {
      const source = agentByName.get(normalizedName(connection.from))!
      const target = agentByName.get(normalizedName(connection.to))!
      const filter = planFilters[index]
      return [
        { id: createId(), ownerAgentId: source.id, projectPath, sourceId: source.id, targetId: filter.id, condition: 'Immer', prompt: '' },
        { id: createId(), ownerAgentId: source.id, projectPath, sourceId: filter.id, targetId: target.id, condition: 'Immer', prompt: 'Übernimm das Ergebnis, prüfe es gemäß deiner Rolle und arbeite selbstständig weiter.' },
      ]
    }),
    ...managedAgents.flatMap((source, index) => [
      { id: createId(), ownerAgentId: source.id, projectPath, sourceId: source.id, targetId: errorFilters[index].id, condition: 'Immer', prompt: '' },
      { id: createId(), ownerAgentId: source.id, projectPath, sourceId: errorFilters[index].id, targetId: manager.id, condition: 'Immer', prompt: 'Prüfe den fehlgeschlagenen Lauf, entscheide über den nächsten Schritt und gib dem Benutzer eine klare Rückmeldung.' },
    ]),
    ...plan.stops.flatMap((item, index) => {
      const source = agentByName.get(normalizedName(item.from))!
      return [
        { id: createId(), ownerAgentId: source.id, projectPath, sourceId: source.id, targetId: stopFilters[index].id, condition: 'Immer', prompt: '' },
        { id: createId(), ownerAgentId: source.id, projectPath, sourceId: stopFilters[index].id, targetId: stopFilters[index].stopId, condition: 'Immer', prompt: '' },
      ]
    }),
  ]
  const allFilters = [...planFilters, ...errorFilters, ...stopFilters]
  const filterIds = new Set(allFilters.map((filter) => filter.id))
  const sourceIds = new Set(plan.connections.map((connection) => agentByName.get(normalizedName(connection.from))!.id))
  const proposedPairs = new Set(plan.connections.map((connection) => `${agentByName.get(normalizedName(connection.from))!.id}:${agentByName.get(normalizedName(connection.to))!.id}`))
  const retainedRoutes = input.routes.filter((route) => !(samePath(route.projectPath, projectPath) && (
    route.sourceId === configuredInitial.id || filterIds.has(route.sourceId) || filterIds.has(route.targetId) ||
    (sourceIds.has(route.sourceId) && proposedPairs.has(`${route.sourceId}:${route.targetId}`))
  )))
  const boardAgentIds = { ...input.boardAgentIds, [manager.id]: Array.from(new Set([manager.id, startAgent.id])) }
  plan.connections.forEach((connection) => {
    const source = agentByName.get(normalizedName(connection.from))!
    const target = agentByName.get(normalizedName(connection.to))!
    boardAgentIds[source.id] = Array.from(new Set([source.id, ...(boardAgentIds[source.id] ?? []), target.id]))
  })
  managedAgents.forEach((source) => {
    boardAgentIds[source.id] = Array.from(new Set([source.id, ...(boardAgentIds[source.id] ?? []), manager.id]))
  })
  const positions = {
    ...input.positions,
    [`${manager.id}:${configuredInitial.id}`]: { x: 50, y: 90 },
    [`${manager.id}:${startAgent.id}`]: { x: 280, y: 90 },
    ...Object.fromEntries(plan.connections.flatMap((connection, index) => {
      const source = agentByName.get(normalizedName(connection.from))!
      const target = agentByName.get(normalizedName(connection.to))!
      const branchIndex = plan.connections.slice(0, index).filter((item) => normalizedName(item.from) === normalizedName(connection.from)).length
      const y = 60 + branchIndex * 140
      return [[`${source.id}:${source.id}`, { x: 40, y: 130 }], [`${source.id}:${planFilters[index].id}`, { x: 270, y }], [`${source.id}:${target.id}`, { x: 500, y }]]
    })),
    ...Object.fromEntries(managedAgents.flatMap((source, index) => [[`${source.id}:${errorFilters[index].id}`, { x: 270, y: 300 }], [`${source.id}:${manager.id}`, { x: 500, y: 300 }]])),
    ...Object.fromEntries(plan.stops.flatMap((item, index) => {
      const source = agentByName.get(normalizedName(item.from))!
      return [[`${source.id}:${stopFilters[index].id}`, { x: 270, y: 460 + index * 120 }], [`${source.id}:${planStops[index].id}`, { x: 500, y: 460 + index * 120 }]]
    })),
  }

  return {
    initials: [...input.initials.filter((item) => item.id !== configuredInitial.id), configuredInitial],
    filters: [...input.filters.filter((item) => !allFilters.some((filter) => filter.id === item.id)), ...planFilters, ...errorFilters, ...stopFilters.map(({ stopId: _stopId, ...filter }) => filter)],
    stops: [...input.stops.filter((item) => !planStops.some((stop) => stop.id === item.id)), ...planStops],
    routes: [...retainedRoutes, ...newRoutes],
    boardAgentIds,
    positions,
  }
}
