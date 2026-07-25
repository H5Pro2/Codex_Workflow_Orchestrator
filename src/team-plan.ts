export const MANAGEMENT_ERROR_STATUS_NAME = 'Fehler'
export const MANAGEMENT_ERROR_STATUS_MEANING =
  'Der Agent konnte seinen Codex-Lauf nicht abschließen und benötigt eine Entscheidung oder neue Anweisung.'

export type ManagementTeamPlanAgent = {
  name: string
  role: string
  prompt: string
  usesProjectKnowledge: boolean
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
  startStatus: string
  startInstruction: string
  statusCommands: ManagementTeamPlanStatusCommand[]
  agents: ManagementTeamPlanAgent[]
  connections: ManagementTeamPlanConnection[]
  stops: ManagementTeamPlanStop[]
}

export function isExplicitTeamProvisioningRequest(text: string) {
  const normalized = text.trim().toLocaleLowerCase('de-DE')
  if (!normalized) return false

  return Boolean(
    /\b(?:teamvorschlag|team-plan|teamplan)\b/.test(normalized) ||
    /\b(?:team|projektteam)\b.{0,48}\b(?:erstellen|anlegen|aufbauen|zusammenstellen|restrukturieren|ersetzen)\b/.test(normalized) ||
    /\b(?:erstelle|erstellen|lege|anlegen|baue|aufbauen|stelle|zusammenstellen|restrukturiere|ersetze)\b.{0,48}\b(?:team|projektteam)\b/.test(normalized) ||
    /\b(?:neuen|weiteren|zusaetzlichen|zusätzlichen)\s+agent(?:en)?\b/.test(normalized) ||
    /\bagent(?:en)?\b.{0,32}\b(?:hinzufuegen|hinzufügen|anlegen|erstellen|ersetzen)\b/.test(normalized)
  )
}

export function findAuthorizedManagementTeamPlan(messages: Array<{ role: string; text: string }>) {
  for (let assistantIndex = messages.length - 1; assistantIndex >= 0; assistantIndex -= 1) {
    const assistantMessage = messages[assistantIndex]
    if (assistantMessage.role !== 'assistant') continue
    const parsed = parseManagementTeamPlan(assistantMessage.text)
    if (!parsed) return null

    for (let requestIndex = assistantIndex - 1; requestIndex >= 0; requestIndex -= 1) {
      const request = messages[requestIndex]
      if (request.role !== 'user') continue
      return isExplicitTeamProvisioningRequest(request.text) ? parsed : null
    }
    return null
  }
  return null
}

export type TeamAgentRef = { id: string; name: string }
export type TeamStatus = { id: string; projectPath: string; name: string; description: string }
export type TeamInitial = {
  id: string
  ownerAgentId: string
  projectPath: string
  name: string
  instruction: string
  instructionSource?: 'user'
}
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

type ManagementStartRepairInput = {
  manager: TeamAgentRef
  projectPath: string
  initials: TeamInitial[]
  filters: TeamStatusFilter[]
  routes: TeamRoute[]
  boardAgentIds: Record<string, string[]>
  positions: Record<string, { x: number; y: number }>
  createId: () => string
}

export function repairManagementStartTopology(input: ManagementStartRepairInput) {
  const managerInitials = input.initials.filter((initial) =>
    initial.ownerAgentId === input.manager.id && samePath(initial.projectPath, input.projectPath),
  )
  if (managerInitials.length === 0) {
    return { initials: input.initials, routes: input.routes, positions: input.positions, changed: false }
  }

  let changed = false
  const managerInitialIds = new Set(managerInitials.map((initial) => initial.id))
  const initials = input.initials.map((initial) => {
    if (!managerInitialIds.has(initial.id)) return initial
    const keepsUserInstruction = initial.instructionSource === 'user'
    if (initial.name === 'Start' && (keepsUserInstruction || !initial.instruction)) return initial
    changed = true
    if (keepsUserInstruction) return { ...initial, name: 'Start' }
    const sanitized = { ...initial, name: 'Start', instruction: '' }
    delete sanitized.instructionSource
    return sanitized
  })
  const retainedInitialTargets = new Set<string>()
  let routes = input.routes.flatMap((route) => {
    if (!managerInitialIds.has(route.sourceId)) return [route]
    if (route.targetId !== input.manager.id) {
      changed = true
      return []
    }
    const pair = `${route.sourceId}:${route.targetId}`
    if (retainedInitialTargets.has(pair)) {
      changed = true
      return []
    }
    retainedInitialTargets.add(pair)
    if (route.ownerAgentId === input.manager.id && route.prompt === '') return [route]
    changed = true
    return [{ ...route, ownerAgentId: input.manager.id, prompt: '' }]
  })
  const positions = { ...input.positions }
  const setPosition = (nodeId: string, position: { x: number; y: number }) => {
    const key = `${input.manager.id}:${nodeId}`
    const current = positions[key]
    if (current?.x === position.x && current.y === position.y) return
    changed = true
    positions[key] = position
  }

  managerInitials.forEach((initial, index) => {
    setPosition(initial.id, { x: 50, y: 90 + index * 130 })
    if (routes.some((route) => route.sourceId === initial.id && route.targetId === input.manager.id)) return
    changed = true
    routes.push({
      id: input.createId(), ownerAgentId: input.manager.id, projectPath: input.projectPath,
      sourceId: initial.id, targetId: input.manager.id, condition: 'Immer', prompt: '',
    })
  })

  const startFilters = input.filters.filter((filter) =>
    filter.ownerAgentId === input.manager.id && samePath(filter.projectPath, input.projectPath),
  )
  const specialistIds = (input.boardAgentIds[input.manager.id] ?? []).filter((id) => id !== input.manager.id)
  if (startFilters.length === 1 && specialistIds.length === 1) {
    const [startFilter] = startFilters
    const [specialistId] = specialistIds
    setPosition(input.manager.id, { x: 280, y: 90 })
    setPosition(startFilter.id, { x: 510, y: 90 })
    setPosition(specialistId, { x: 740, y: 90 })
    if (!routes.some((route) => route.sourceId === input.manager.id && route.targetId === startFilter.id)) {
      changed = true
      routes.push({
        id: input.createId(), ownerAgentId: input.manager.id, projectPath: input.projectPath,
        sourceId: input.manager.id, targetId: startFilter.id, condition: 'Immer', prompt: '',
      })
    }
    if (!routes.some((route) => route.sourceId === startFilter.id && route.targetId === specialistId)) {
      changed = true
      routes.push({
        id: input.createId(), ownerAgentId: input.manager.id, projectPath: input.projectPath,
        sourceId: startFilter.id, targetId: specialistId, condition: 'Immer',
        prompt: 'Übernimm die vom CEO freigegebene Aufgabe und bearbeite sie gemäß deiner Rolle.',
      })
    }
  }

  return { initials, routes, positions, changed }
}

function normalizedName(value: string) {
  return value.trim().toLocaleLowerCase('de-DE')
}

function samePath(left: string, right: string) {
  return left.replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE') ===
    right.replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE')
}

export function parseManagementTeamPlan(text: string): { plan: ManagementTeamPlan; signature: string } | null {
  const matches = [...text.matchAll(/<orchestrator_team_plan>\s*([\s\S]*?)\s*<\/orchestrator_team_plan>/gi)]
  if (matches.length === 0) return null

  for (const match of matches.reverse()) {
    try {
    const raw = JSON.parse(match[1]) as Record<string, unknown>
    if (!Array.isArray(raw.agents) || raw.agents.length === 0 || raw.agents.length > 12) throw new Error('invalid agents')
    const agents = raw.agents.map((entry) => {
      if (!entry || typeof entry !== 'object') throw new Error('invalid agent')
      const item = entry as Record<string, unknown>
      const name = typeof item.name === 'string' ? item.name.trim() : ''
      const role = typeof item.role === 'string' ? item.role.trim() : ''
      const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : ''
      const usesProjectKnowledge = item.usesProjectKnowledge
      if (!name || !role || !prompt || name.length > 80 || typeof usesProjectKnowledge !== 'boolean') {
        throw new Error('invalid agent')
      }
      return {
        name,
        role,
        prompt,
        usesProjectKnowledge,
        workflowStatuses: Array.isArray(item.workflowStatuses)
          ? item.workflowStatuses.filter((status): status is string => typeof status === 'string').map((status) => status.trim()).filter(Boolean)
          : [],
      }
    })
    const normalizedNames = agents.map((agent) => normalizedName(agent.name))
    if (new Set(normalizedNames).size !== normalizedNames.length) throw new Error('duplicate agents')

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
    if (statusCommands.length > 20) throw new Error('too many status commands')
    if (!statusCommands.some((status) => normalizedName(status.name) === normalizedName(MANAGEMENT_ERROR_STATUS_NAME))) {
      statusCommands.push({ name: MANAGEMENT_ERROR_STATUS_NAME, meaning: MANAGEMENT_ERROR_STATUS_MEANING })
    }
    agents.forEach((agent) => {
      if (!agent.workflowStatuses.some((status) => normalizedName(status) === normalizedName(MANAGEMENT_ERROR_STATUS_NAME))) {
        agent.workflowStatuses.push(MANAGEMENT_ERROR_STATUS_NAME)
      }
    })
    if (statusCommands.length > 20) throw new Error('too many status commands')
    const normalizedStatusNames = statusCommands.map((status) => normalizedName(status.name))
    if (new Set(normalizedStatusNames).size !== normalizedStatusNames.length) throw new Error('duplicate status commands')

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
    if (stops.length > 12) throw new Error('too many stops')
    ;[...connections, ...stops].forEach((path) => {
      const source = agents.find((agent) => normalizedName(agent.name) === normalizedName(path.from))
      if (source && !source.workflowStatuses.some((status) => normalizedName(status) === normalizedName(path.status))) {
        source.workflowStatuses.push(path.status)
      }
    })
    const projectGoal = typeof raw.projectGoal === 'string' ? raw.projectGoal.trim() : ''
    const requestedStartAgent = typeof raw.startAgent === 'string' ? raw.startAgent.trim() : ''
    const startAgent = agents.find((agent) => normalizedName(agent.name) === normalizedName(requestedStartAgent))?.name ?? agents[0].name
    const requestedStartStatus = typeof raw.startStatus === 'string' ? raw.startStatus.trim() : ''
    const startStatus = statusCommands.find((status) => normalizedName(status.name) === normalizedName(requestedStartStatus))?.name ??
      statusCommands.find((status) => normalizedName(status.name) !== normalizedName(MANAGEMENT_ERROR_STATUS_NAME))?.name ?? ''
    if (!startStatus || normalizedName(startStatus) === normalizedName(MANAGEMENT_ERROR_STATUS_NAME)) {
      throw new Error('invalid start status')
    }
    const startInstruction = typeof raw.startInstruction === 'string' && raw.startInstruction.trim()
      ? raw.startInstruction.trim()
      : `Beginne mit der dir zugewiesenen Arbeit für dieses Projektziel: ${projectGoal || 'Setze den beschriebenen Teamauftrag um.'}`
    const plan = { projectGoal, startAgent, startStatus, startInstruction, statusCommands, agents, connections, stops }
      return { plan, signature: JSON.stringify(plan) }
    } catch {
      continue
    }
  }

  return null
}

export function looksLikeManagementTeamPlan(text: string) {
  const normalized = text.trim().toLocaleLowerCase('de-DE')
  if (!normalized || /<orchestrator_team_plan>/i.test(text)) return false

  const planningSignals = [
    'teamvorschlag',
    'teamproposal',
    'controlled_team_takeover',
    'statusbefehle',
    'status_commands',
    'workflow-dashboard',
    'workflow dashboard',
    'workflow_dashboard_connections',
    'startbereit',
    'ready_for_controlled_takeover',
  ]
  return planningSignals.filter((signal) => normalized.includes(signal)).length >= 3
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

  const existingInitial = input.initials.find((item) =>
    item.ownerAgentId === manager.id && (item.name === 'Start' || item.name === 'Team-Start'),
  )
  const configuredInitial = {
    id: existingInitial?.id ?? createId(), ownerAgentId: manager.id, projectPath,
    name: 'Start',
    instruction: existingInitial?.instructionSource === 'user' ? existingInitial.instruction : '',
    ...(existingInitial?.instructionSource === 'user' ? { instructionSource: 'user' as const } : {}),
  }
  const startStatus = statusByName.get(normalizedName(plan.startStatus))
  if (!startStatus) throw new Error(`Statusbefehl fehlt: ${plan.startStatus}`)
  const startFilterName = `${plan.startStatus}: ${manager.name} → ${startAgent.name}`
  const existingStartFilter = input.filters.find((item) =>
    item.ownerAgentId === manager.id && samePath(item.projectPath, projectPath) && item.name === startFilterName,
  )
  const startFilter = {
    id: existingStartFilter?.id ?? createId(), ownerAgentId: manager.id, projectPath,
    name: startFilterName, statusId: startStatus.id,
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
  // A management agent must never route its own technical error back to itself.
  // Such an error requires a user decision and is handled as an Auto Stop.
  const errorSources = managedAgents.filter((source) => source.id !== manager.id)
  const errorFilters = errorSources.map((source) => {
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
    { id: createId(), ownerAgentId: manager.id, projectPath, sourceId: configuredInitial.id, targetId: manager.id, condition: 'Immer', prompt: '' },
    { id: createId(), ownerAgentId: manager.id, projectPath, sourceId: manager.id, targetId: startFilter.id, condition: 'Immer', prompt: '' },
    { id: createId(), ownerAgentId: manager.id, projectPath, sourceId: startFilter.id, targetId: startAgent.id, condition: 'Immer', prompt: 'Übernimm die vom CEO freigegebene Aufgabe und bearbeite sie gemäß deiner Rolle.' },
    ...plan.connections.flatMap((connection, index) => {
      const source = agentByName.get(normalizedName(connection.from))!
      const target = agentByName.get(normalizedName(connection.to))!
      const filter = planFilters[index]
      return [
        { id: createId(), ownerAgentId: source.id, projectPath, sourceId: source.id, targetId: filter.id, condition: 'Immer', prompt: '' },
        { id: createId(), ownerAgentId: source.id, projectPath, sourceId: filter.id, targetId: target.id, condition: 'Immer', prompt: 'Übernimm das Ergebnis, prüfe es gemäß deiner Rolle und arbeite selbstständig weiter.' },
      ]
    }),
    ...errorSources.flatMap((source, index) => [
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
  const projectOwnerIds = new Set([
    manager.id,
    ...managedAgents.map((agent) => agent.id),
    ...input.initials.filter((item) => samePath(item.projectPath, projectPath)).map((item) => item.ownerAgentId),
    ...input.filters.filter((item) => samePath(item.projectPath, projectPath)).map((item) => item.ownerAgentId),
    ...input.stops.filter((item) => samePath(item.projectPath, projectPath)).map((item) => item.ownerAgentId),
    ...input.routes.filter((item) => samePath(item.projectPath, projectPath)).map((item) => item.ownerAgentId),
  ])
  const boardAgentIds = Object.fromEntries(
    Object.entries(input.boardAgentIds).filter(([ownerId]) => !projectOwnerIds.has(ownerId)),
  )
  boardAgentIds[manager.id] = Array.from(new Set([manager.id, startAgent.id]))
  plan.connections.forEach((connection) => {
    const source = agentByName.get(normalizedName(connection.from))!
    const target = agentByName.get(normalizedName(connection.to))!
    boardAgentIds[source.id] = Array.from(new Set([source.id, ...(boardAgentIds[source.id] ?? []), target.id]))
  })
  errorSources.forEach((source) => {
    boardAgentIds[source.id] = Array.from(new Set([source.id, ...(boardAgentIds[source.id] ?? []), manager.id]))
  })
  const retainedPositions = Object.fromEntries(
    Object.entries(input.positions).filter(([key]) => !projectOwnerIds.has(key.split(':', 1)[0])),
  )
  const positions = {
    ...retainedPositions,
    [`${manager.id}:${configuredInitial.id}`]: { x: 50, y: 90 },
    [`${manager.id}:${manager.id}`]: { x: 280, y: 90 },
    [`${manager.id}:${startFilter.id}`]: { x: 510, y: 90 },
    [`${manager.id}:${startAgent.id}`]: { x: 740, y: 90 },
    ...Object.fromEntries(plan.connections.flatMap((connection, index) => {
      const source = agentByName.get(normalizedName(connection.from))!
      const target = agentByName.get(normalizedName(connection.to))!
      const branchIndex = plan.connections.slice(0, index).filter((item) => normalizedName(item.from) === normalizedName(connection.from)).length
      const y = 60 + branchIndex * 140
      return [[`${source.id}:${source.id}`, { x: 40, y: 130 }], [`${source.id}:${planFilters[index].id}`, { x: 270, y }], [`${source.id}:${target.id}`, { x: 500, y }]]
    })),
    ...Object.fromEntries(errorSources.flatMap((source, index) => [[`${source.id}:${errorFilters[index].id}`, { x: 270, y: 300 }], [`${source.id}:${manager.id}`, { x: 500, y: 300 }]])),
    ...Object.fromEntries(plan.stops.flatMap((item, index) => {
      const source = agentByName.get(normalizedName(item.from))!
      return [[`${source.id}:${stopFilters[index].id}`, { x: 270, y: 460 + index * 120 }], [`${source.id}:${planStops[index].id}`, { x: 500, y: 460 + index * 120 }]]
    })),
  }

  return {
    initials: [...input.initials.filter((item) => !samePath(item.projectPath, projectPath)), configuredInitial],
    filters: [...input.filters.filter((item) => !samePath(item.projectPath, projectPath)), startFilter, ...planFilters, ...errorFilters, ...stopFilters.map(({ stopId: _stopId, ...filter }) => filter)],
    stops: [...input.stops.filter((item) => !samePath(item.projectPath, projectPath)), ...planStops],
    routes: [...input.routes.filter((item) => !samePath(item.projectPath, projectPath)), ...newRoutes],
    boardAgentIds,
    positions,
  }
}
