import { readFile, rename, writeFile } from 'node:fs/promises'

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize)
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    )
  }
  return value
}

function stableStateString(state) {
  return JSON.stringify(canonicalize(state))
}

function mergeWorkflowLoopCounts(previousState, nextState) {
  if (!nextState || typeof nextState !== 'object' || Array.isArray(nextState)) {
    return nextState
  }
  const hasPreviousCounts =
    previousState?.workflowLoopCounts &&
    typeof previousState.workflowLoopCounts === 'object' &&
    !Array.isArray(previousState.workflowLoopCounts)
  const hasNextCounts =
    nextState.workflowLoopCounts &&
    typeof nextState.workflowLoopCounts === 'object' &&
    !Array.isArray(nextState.workflowLoopCounts)
  if (!hasPreviousCounts && !hasNextCounts) {
    return nextState
  }
  const previousCounts = hasPreviousCounts ? previousState.workflowLoopCounts : {}
  const nextCounts = hasNextCounts ? nextState.workflowLoopCounts : {}
  return {
    ...nextState,
    workflowLoopCounts: {
      ...previousCounts,
      ...nextCounts,
    },
  }
}

function mergeWorkflowLoops(previousState, nextState) {
  if (!nextState || typeof nextState !== 'object' || Array.isArray(nextState)) {
    return nextState
  }
  const previousLoops = Array.isArray(previousState?.workflowLoops) ? previousState.workflowLoops : []
  const nextLoops = Array.isArray(nextState.workflowLoops) ? nextState.workflowLoops : []
  if (previousLoops.length === 0 || nextLoops.length > 0) {
    return nextState
  }
  const nextRoutes = Array.isArray(nextState.routes) ? nextState.routes : []
  const referencedNodeIds = new Set(nextRoutes.flatMap((route) => [route?.sourceId, route?.targetId]).filter(Boolean))
  const retainedLoops = previousLoops.filter((loop) => referencedNodeIds.has(loop?.id))
  return retainedLoops.length > 0
    ? { ...nextState, workflowLoops: retainedLoops }
    : nextState
}

function sameProjectPath(left, right) {
  return String(left || '').toLocaleLowerCase() === String(right || '').toLocaleLowerCase()
}

function isLegacyTeamTopologyFilter(filter) {
  const name = String(filter?.name || '').trim()
  return (
    /^Weiterleitung:\s.+\s(?:→|->)\s.+$/u.test(name) ||
    /^Fehler:\s.+\s->\s.+$/u.test(name) ||
    /^Projekt abgeschlossen:\s.+\s->\s.+$/u.test(name) ||
    name === 'Status: Weiterleitung'
  )
}

function sanitizeManualState(nextState) {
  if (!nextState || typeof nextState !== 'object' || Array.isArray(nextState)) {
    return nextState
  }
  const sanitized = { ...nextState }
  const pruneDanglingRoutes = () => {
    if (!Array.isArray(sanitized.routes)) return
    const validNodeIds = new Set()
    ;['agents', 'workflowPrompts', 'workflowInitials', 'workflowStops', 'workflowLoops', 'workflowTimers'].forEach((key) => {
      const collection = Array.isArray(sanitized[key]) ? sanitized[key] : []
      collection.forEach((item) => {
        if (item?.id) validNodeIds.add(item.id)
      })
    })
    sanitized.routes = sanitized.routes.filter((route) => {
      if (!route || typeof route !== 'object') return false
      if (!('sourceId' in route) && !('targetId' in route)) return true
      return validNodeIds.has(route.sourceId) && validNodeIds.has(route.targetId)
    })
  }
  if (Array.isArray(sanitized.agents)) {
    sanitized.agents = sanitized.agents.map((agent) => {
      if (!agent || typeof agent !== 'object' || Array.isArray(agent)) return agent
      if (!('teamProvisioningEnabled' in agent) && !('lastAppliedTeamPlanSignature' in agent)) {
        return agent
      }
      const {
        lastAppliedTeamPlanSignature: _removedSignature,
        teamProvisioningEnabled: _removedFlag,
        ...rest
      } = agent
      return rest
    })
  }
  if (sanitized.workflowBoardAgentIds && typeof sanitized.workflowBoardAgentIds === 'object') {
    sanitized.workflowBoardAgentIds = Object.fromEntries(
      Object.entries(sanitized.workflowBoardAgentIds).filter(([key, value]) =>
        key.startsWith('project:') && Array.isArray(value),
      ),
    )
  }
  if (sanitized.workflowBoardNodeIds && typeof sanitized.workflowBoardNodeIds === 'object') {
    sanitized.workflowBoardNodeIds = Object.fromEntries(
      Object.entries(sanitized.workflowBoardNodeIds).filter(([key, value]) =>
        key.startsWith('project:') && Array.isArray(value),
      ),
    )
  }
  if (sanitized.workflowPositions && typeof sanitized.workflowPositions === 'object') {
    sanitized.workflowPositions = Object.fromEntries(
      Object.entries(sanitized.workflowPositions).filter(([key]) => key.startsWith('project:')),
    )
  }

  const legacyProjectPaths = new Set(
    (Array.isArray(sanitized.workflowStatusFilters) ? sanitized.workflowStatusFilters : [])
      .filter(isLegacyTeamTopologyFilter)
      .map((filter) => filter.projectPath)
      .filter(Boolean),
  )
  delete sanitized.workflowStatusFilters
  if (legacyProjectPaths.size === 0) {
    pruneDanglingRoutes()
    return sanitized
  }

  const isLegacyProjectItem = (item) =>
    [...legacyProjectPaths].some((projectPath) => sameProjectPath(item?.projectPath, projectPath))
  const projectAgentIds = new Set(
    (Array.isArray(sanitized.agents) ? sanitized.agents : [])
      .filter(isLegacyProjectItem)
      .map((agent) => agent.id)
      .filter(Boolean),
  )
  const removedNodeIds = new Set()
  ;['workflowPrompts', 'workflowInitials', 'workflowStops', 'workflowLoops', 'workflowTimers'].forEach((key) => {
    const collection = Array.isArray(sanitized[key]) ? sanitized[key] : []
    collection.filter(isLegacyProjectItem).forEach((item) => {
      if (item?.id) removedNodeIds.add(item.id)
    })
    sanitized[key] = collection.filter((item) => !isLegacyProjectItem(item))
  })
  sanitized.routes = (Array.isArray(sanitized.routes) ? sanitized.routes : []).filter((route) =>
    !isLegacyProjectItem(route) &&
    !removedNodeIds.has(route?.sourceId) &&
    !removedNodeIds.has(route?.targetId)
  )
  sanitized.workflowPositions = Object.fromEntries(
    Object.entries(sanitized.workflowPositions || {}).filter(([key]) => {
      const separator = key.indexOf(':')
      const ownerId = separator > 0 ? key.slice(0, separator) : ''
      const nodeId = separator > 0 ? key.slice(separator + 1) : ''
      if (removedNodeIds.has(nodeId) || projectAgentIds.has(ownerId)) return false
      return ![...legacyProjectPaths].some((projectPath) => key.startsWith(`project:${projectPath}:`))
    }),
  )
  sanitized.workflowBoardNodeIds = Object.fromEntries(
    Object.entries(sanitized.workflowBoardNodeIds || {}).flatMap(([key, value]) => {
      if (!Array.isArray(value)) return []
      const nodeIds = value.filter((id) => !removedNodeIds.has(id))
      return nodeIds.length > 0 ? [[key, nodeIds]] : []
    }),
  )
  ;[...legacyProjectPaths].forEach((projectPath) => {
    sanitized.workflowBoardAgentIds[`project:${projectPath}`] = (Array.isArray(sanitized.agents) ? sanitized.agents : [])
      .filter((agent) => sameProjectPath(agent?.projectPath, projectPath))
      .map((agent) => agent.id)
      .filter(Boolean)
  })
  pruneDanglingRoutes()
  return sanitized
}

function collectionSize(state, key) {
  const value = state?.[key]
  return Array.isArray(value) ? value.length : 0
}

function rejectsDestructiveEmptySnapshot(previousState, nextState) {
  if (!previousState || !nextState) {
    return false
  }
  const previousTopologySize =
    collectionSize(previousState, 'agents') +
    collectionSize(previousState, 'routes') +
    collectionSize(previousState, 'workflowInitials') +
    collectionSize(previousState, 'workflowLoops')
  const nextTopologySize =
    collectionSize(nextState, 'agents') +
    collectionSize(nextState, 'routes') +
    collectionSize(nextState, 'workflowInitials') +
    collectionSize(nextState, 'workflowLoops')
  return previousTopologySize > 0 && nextTopologySize === 0
}

function nextVersion(previousVersion, now) {
  const previousTime = Date.parse(previousVersion)
  const currentTime = now().getTime()
  return new Date(
    Number.isFinite(previousTime) ? Math.max(currentTime, previousTime + 1) : currentTime,
  ).toISOString()
}

export function createSharedStateStore(stateFile, { now = () => new Date() } = {}) {
  let loaded = false
  let state = null
  let updatedAt = ''
  let pendingWrite = Promise.resolve()

  async function load() {
    if (loaded) return
    try {
      const parsed = JSON.parse(await readFile(stateFile, 'utf8'))
      state = parsed.state ?? null
      updatedAt = parsed.updatedAt ?? ''
    } catch {
      state = null
      updatedAt = ''
    }
    loaded = true
  }

  async function read() {
    await pendingWrite
    await load()
    return { state, updatedAt }
  }

  function update(nextState, { expectedUpdatedAt, force = false } = {}) {
    const operation = pendingWrite.then(async () => {
      await load()
      if (
        !force &&
        typeof expectedUpdatedAt === 'string' &&
        expectedUpdatedAt !== updatedAt
      ) {
        return { ok: false, state, updatedAt }
      }

      const mergedNextState = sanitizeManualState(mergeWorkflowLoops(state, mergeWorkflowLoopCounts(state, nextState)))
      if (!force && rejectsDestructiveEmptySnapshot(state, mergedNextState)) {
        return { ok: false, state, updatedAt }
      }

      if (stableStateString(state) === stableStateString(mergedNextState)) {
        return { ok: true, state, updatedAt }
      }

      const nextUpdatedAt = nextVersion(updatedAt, now)
      const temporaryFile = `${stateFile}.tmp`
      await writeFile(
        temporaryFile,
        JSON.stringify({ updatedAt: nextUpdatedAt, state: mergedNextState }, null, 2),
        'utf8',
      )
      await rename(temporaryFile, stateFile)
      state = mergedNextState
      updatedAt = nextUpdatedAt
      return { ok: true, state, updatedAt }
    })

    pendingWrite = operation.then(
      () => undefined,
      () => undefined,
    )
    return operation
  }

  return { read, update }
}
