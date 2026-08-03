import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { createSharedStateStore } from './shared-state.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

async function createStore() {
  const directory = await mkdtemp(join(tmpdir(), 'codex-orchestrator-state-'))
  temporaryDirectories.push(directory)
  const stateFile = join(directory, 'state.json')
  const fixedTime = new Date('2026-07-23T12:00:00.000Z')
  return {
    stateFile,
    store: createSharedStateStore(stateFile, { now: () => fixedTime }),
  }
}

test('writes complete state snapshots atomically and keeps versions monotonic', async () => {
  const { stateFile, store } = await createStore()
  const first = await store.update({ agents: [{ id: 'ceo' }], routes: [] }, { force: true })
  const second = await store.update(
    { agents: [{ id: 'ceo' }, { id: 'developer' }], routes: [{ from: 'ceo', to: 'developer' }] },
    { expectedUpdatedAt: first.updatedAt },
  )

  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.ok(second.updatedAt > first.updatedAt)
  assert.deepEqual(JSON.parse(await readFile(stateFile, 'utf8')), {
    updatedAt: second.updatedAt,
    state: {
      agents: [{ id: 'ceo' }, { id: 'developer' }],
      routes: [{ from: 'ceo', to: 'developer' }],
    },
  })
  await assert.rejects(stat(`${stateFile}.tmp`), { code: 'ENOENT' })
})

test('rejects a stale tab without overwriting the newer snapshot', async () => {
  const { stateFile, store } = await createStore()
  const initial = await store.update({ revision: 1 }, { force: true })
  const newer = await store.update(
    { revision: 2, source: 'current-tab' },
    { expectedUpdatedAt: initial.updatedAt },
  )
  const stale = await store.update(
    { revision: 2, source: 'stale-tab' },
    { expectedUpdatedAt: initial.updatedAt },
  )

  assert.deepEqual(stale, {
    ok: false,
    state: { revision: 2, source: 'current-tab' },
    updatedAt: newer.updatedAt,
  })
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).state.source, 'current-tab')
})

test('serializes concurrent writes so only one tab can win', async () => {
  const { store } = await createStore()
  const initial = await store.update({ winner: null }, { force: true })
  const [first, second] = await Promise.all([
    store.update({ winner: 'first' }, { expectedUpdatedAt: initial.updatedAt }),
    store.update({ winner: 'second' }, { expectedUpdatedAt: initial.updatedAt }),
  ])

  assert.equal(first.ok, true)
  assert.equal(second.ok, false)
  assert.equal((await store.read()).state.winner, 'first')
})

test('rejects an accidental empty topology snapshot over existing workflow data', async () => {
  const { stateFile, store } = await createStore()
  const initial = await store.update({
    agents: [{ id: 'ceo' }],
    routes: [{ id: 'route-1' }],
    workflowInitials: [{ id: 'initial-1' }],
    workflowLoopCounts: {
      'project-one': 3,
    },
  }, { force: true })
  const emptySnapshot = await store.update({
    agents: [],
    routes: [],
    workflowInitials: [],
    workflowLoopCounts: {},
  }, { expectedUpdatedAt: initial.updatedAt })

  assert.equal(emptySnapshot.ok, false)
  assert.equal(emptySnapshot.updatedAt, initial.updatedAt)
  assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).state.agents.length, 1)
})

test('does not create a new version for semantically identical state', async () => {
  const { store } = await createStore()
  const first = await store.update({ routes: [], agent: { name: 'CEO', role: 'Lead' } })
  const unchanged = await store.update(
    { agent: { role: 'Lead', name: 'CEO' }, routes: [] },
    { expectedUpdatedAt: first.updatedAt },
  )

  assert.equal(unchanged.ok, true)
  assert.equal(unchanged.updatedAt, first.updatedAt)
})

test('keeps project loop counts after the shared-state store is restarted', async () => {
  const { stateFile, store } = await createStore()
  await store.update({
    agents: [],
    workflowLoopCounts: {
      'project-one': 3,
      'project-two': 5,
    },
  }, { force: true })

  const restartedStore = createSharedStateStore(stateFile)
  const reloaded = await restartedStore.read()

  assert.deepEqual(reloaded.state.workflowLoopCounts, {
    'project-one': 3,
    'project-two': 5,
  })
})

test('merges project loop counts when an older tab writes a full snapshot', async () => {
  const { store } = await createStore()
  const initial = await store.update({
    agents: [],
    workflowLoopCounts: {
      'project-one': 3,
    },
  }, { force: true })
  const staleFullSnapshot = await store.update({
    agents: [{ id: 'ceo' }],
    workflowLoopCounts: {},
  }, { expectedUpdatedAt: initial.updatedAt })

  assert.equal(staleFullSnapshot.ok, true)
  assert.deepEqual((await store.read()).state.workflowLoopCounts, {
    'project-one': 3,
  })
})

test('strips disabled team provisioning metadata from shared snapshots', async () => {
  const { store } = await createStore()
  await store.update({
    agents: [{
      id: 'ceo',
      teamProvisioningEnabled: true,
      lastAppliedTeamPlanSignature: 'legacy-signature',
    }],
  }, { force: true })

  assert.deepEqual((await store.read()).state.agents, [{ id: 'ceo' }])
})

test('removes legacy generated team topology from stale snapshots', async () => {
  const { store } = await createStore()
  await store.update({
    agents: [
      { id: 'reviewer', projectPath: 'C:\\Project' },
      { id: 'developer', projectPath: 'C:\\Project' },
    ],
    workflowPrompts: [{ id: 'prompt', ownerAgentId: 'reviewer', projectPath: 'C:\\Project', name: 'Weiterleiten' }],
    workflowInitials: [{ id: 'initial', ownerAgentId: 'reviewer', projectPath: 'C:\\Project', name: 'Start' }],
    workflowStatusFilters: [{
      id: 'filter',
      ownerAgentId: 'legacy-agent',
      projectPath: 'C:\\Project',
      name: 'Weiterleitung: Game Designer → Frontend Entwickler',
      statusId: 'forward',
    }],
    workflowStops: [{ id: 'stop', ownerAgentId: 'legacy-agent', projectPath: 'C:\\Project', name: 'Projekt abgeschlossen' }],
    routes: [{ id: 'route', projectPath: 'C:\\Project', sourceId: 'prompt', targetId: 'developer' }],
    workflowPositions: {
      'reviewer:prompt': { x: 1, y: 1 },
      'project:C:\\Project:reviewer': { x: 2, y: 2 },
    },
    workflowBoardAgentIds: {
      reviewer: ['developer'],
    },
    workflowBoardNodeIds: {
      reviewer: ['prompt'],
      'project:C:\\Project': ['prompt'],
    },
  }, { force: true })

  const state = (await store.read()).state
  assert.deepEqual(state.workflowPrompts, [])
  assert.deepEqual(state.workflowInitials, [])
  assert.equal(state.workflowStatusFilters, undefined)
  assert.deepEqual(state.workflowStops, [])
  assert.deepEqual(state.routes, [])
  assert.deepEqual(state.workflowPositions, {})
  assert.deepEqual(state.workflowBoardAgentIds['project:C:\\Project'], ['reviewer', 'developer'])
  assert.equal(state.workflowBoardAgentIds.reviewer, undefined)
  assert.equal(state.workflowBoardNodeIds.reviewer, undefined)
})
