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
    collectionSize(previousState, 'workflowStatusFilters')
  const nextTopologySize =
    collectionSize(nextState, 'agents') +
    collectionSize(nextState, 'routes') +
    collectionSize(nextState, 'workflowInitials') +
    collectionSize(nextState, 'workflowStatusFilters')
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

      const mergedNextState = mergeWorkflowLoopCounts(state, nextState)
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
