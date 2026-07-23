import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createSharedStateStore } from '../server/shared-state.mjs'
import {
  MANAGEMENT_ERROR_STATUS_NAME,
  buildTeamTopology,
  parseManagementTeamPlan,
} from './team-plan.ts'

const teamProposal = `<orchestrator_team_plan>
{
  "projectGoal": "Ein getestetes Browser-Spiel",
  "startAgent": "Architekt",
  "startInstruction": "Erstelle die technische Spezifikation und übergib sie an die Entwicklung.",
  "statusCommands": [
    { "name": "Weiterleitung", "meaning": "Das Ergebnis geht an den nächsten Agenten." },
    { "name": "Überarbeiten", "meaning": "Das Ergebnis benötigt eine weitere Bearbeitung." },
    { "name": "Projekt abgeschlossen", "meaning": "Die Abnahme ist erfolgreich abgeschlossen." }
  ],
  "agents": [
    { "name": "Architekt", "role": "Plant die Architektur", "prompt": "Erstelle eine umsetzbare technische Spezifikation.", "workflowStatuses": ["Weiterleitung"] },
    { "name": "Entwickler", "role": "Implementiert das Produkt", "prompt": "Implementiere die Spezifikation und behebe Rückmeldungen.", "workflowStatuses": ["Weiterleitung"] },
    { "name": "QA", "role": "Prüft das Ergebnis", "prompt": "Teste die Umsetzung und entscheide über Abnahme oder Überarbeitung.", "workflowStatuses": ["Überarbeiten", "Projekt abgeschlossen"] }
  ],
  "connections": [
    { "from": "Architekt", "to": "Entwickler", "status": "Weiterleitung" },
    { "from": "Entwickler", "to": "QA", "status": "Weiterleitung" },
    { "from": "QA", "to": "Entwickler", "status": "Überarbeiten" }
  ],
  "stops": [
    { "from": "QA", "status": "Projekt abgeschlossen", "name": "Abnahme abgeschlossen" }
  ]
}
</orchestrator_team_plan>`

test('builds and atomically persists a complete managed team setup', async () => {
  const parsed = parseManagementTeamPlan(teamProposal)
  assert.ok(parsed)
  const { plan, signature } = parsed
  assert.equal(plan.statusCommands.length, 4)
  assert.ok(plan.statusCommands.some((status) => status.name === MANAGEMENT_ERROR_STATUS_NAME))
  assert.deepEqual(
    plan.agents.map(({ name, role, prompt }) => ({ name, role, prompt })),
    [
      { name: 'Architekt', role: 'Plant die Architektur', prompt: 'Erstelle eine umsetzbare technische Spezifikation.' },
      { name: 'Entwickler', role: 'Implementiert das Produkt', prompt: 'Implementiere die Spezifikation und behebe Rückmeldungen.' },
      { name: 'QA', role: 'Prüft das Ergebnis', prompt: 'Teste die Umsetzung und entscheide über Abnahme oder Überarbeitung.' },
    ],
  )
  plan.agents.forEach((agent) => assert.ok(agent.workflowStatuses.includes(MANAGEMENT_ERROR_STATUS_NAME)))

  let nextId = 0
  const createId = () => `generated-${++nextId}`
  const projectPath = 'C:\\Projects\\team-test'
  const manager = { id: 'agent-ceo', name: 'CEO' }
  const agents = [
    manager,
    { id: 'agent-architect', name: 'Architekt' },
    { id: 'agent-developer', name: 'Entwickler' },
    { id: 'agent-qa', name: 'QA' },
  ]
  const statuses = plan.statusCommands.map((status, index) => ({
    id: `status-${index + 1}`,
    projectPath,
    name: status.name,
    description: status.meaning,
  }))
  const topology = buildTeamTopology({
    plan,
    manager,
    agents,
    projectPath,
    statuses,
    initials: [],
    filters: [],
    stops: [],
    routes: [],
    positions: {},
    boardAgentIds: {},
    createId,
  })

  assert.equal(topology.initials.length, 1)
  assert.equal(topology.filters.length, 7)
  assert.equal(topology.stops.length, 1)
  assert.equal(topology.routes.length, 15)
  const initial = topology.initials[0]
  assert.ok(topology.routes.some((route) => route.sourceId === initial.id && route.targetId === 'agent-architect'))
  assert.ok(topology.routes.some((route) => {
    const filter = topology.filters.find((item) => item.id === route.sourceId)
    return filter?.name === 'Weiterleitung: Architekt → Entwickler' && route.targetId === 'agent-developer'
  }))
  for (const agent of agents.slice(1)) {
    assert.ok(topology.routes.some((route) => {
      const filter = topology.filters.find((item) => item.id === route.sourceId)
      return filter?.name === `Fehler: ${agent.name} -> CEO` && route.targetId === manager.id
    }))
  }
  assert.ok(topology.routes.some((route) => {
    const filter = topology.filters.find((item) => item.id === route.sourceId)
    return filter?.name === 'Projekt abgeschlossen: QA -> Abnahme abgeschlossen' &&
      route.targetId === topology.stops[0].id
  }))
  assert.deepEqual(topology.boardAgentIds['agent-architect'], ['agent-architect', 'agent-developer', 'agent-ceo'])
  assert.deepEqual(topology.boardAgentIds['agent-developer'], ['agent-developer', 'agent-qa', 'agent-ceo'])
  assert.deepEqual(topology.boardAgentIds['agent-qa'], ['agent-qa', 'agent-developer', 'agent-ceo'])

  const directory = await mkdtemp(join(tmpdir(), 'codex-orchestrator-team-'))
  try {
    const store = createSharedStateStore(join(directory, 'state.json'))
    const state = {
      agents: plan.agents.map((specification, index) => ({
        ...agents[index + 1],
        role: specification.role,
        prompt: specification.prompt,
        workflowStatusIds: specification.workflowStatuses.map((name) =>
          statuses.find((status) => status.name === name)?.id,
        ).filter(Boolean),
      })),
      workflowStatuses: statuses,
      workflowInitials: topology.initials,
      workflowStatusFilters: topology.filters,
      workflowStops: topology.stops,
      routes: topology.routes,
      workflowPositions: topology.positions,
      workflowBoardAgentIds: topology.boardAgentIds,
      lastAppliedTeamPlanSignature: signature,
      autoRun: false,
    }
    const saved = await store.update(state, { force: true })
    assert.equal(saved.ok, true)
    assert.deepEqual((await store.read()).state, state)
    assert.equal((await store.read()).state.autoRun, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('replaces stale topology for the managed project without touching other projects', () => {
  const parsed = parseManagementTeamPlan(teamProposal)
  assert.ok(parsed)
  const projectPath = 'C:\\Projects\\team-test'
  const otherProjectPath = 'C:\\Projects\\other'
  const manager = { id: 'agent-ceo', name: 'CEO' }
  const agents = [
    manager,
    { id: 'agent-architect', name: 'Architekt' },
    { id: 'agent-developer', name: 'Entwickler' },
    { id: 'agent-qa', name: 'QA' },
  ]
  const statuses = parsed.plan.statusCommands.map((status, index) => ({
    id: `status-${index + 1}`,
    projectPath,
    name: status.name,
    description: status.meaning,
  }))
  let nextId = 0
  const topology = buildTeamTopology({
    plan: parsed.plan,
    manager,
    agents,
    projectPath,
    statuses,
    initials: [
      { id: 'stale-initial', ownerAgentId: 'stale-agent', projectPath, name: 'Alt', instruction: 'Alt' },
      { id: 'other-initial', ownerAgentId: 'other-agent', projectPath: otherProjectPath, name: 'Other', instruction: 'Other' },
    ],
    filters: [
      { id: 'stale-filter', ownerAgentId: 'stale-agent', projectPath, name: 'Alt', statusId: statuses[0].id },
      { id: 'other-filter', ownerAgentId: 'other-agent', projectPath: otherProjectPath, name: 'Other', statusId: 'other-status' },
    ],
    stops: [
      { id: 'stale-stop', ownerAgentId: 'stale-agent', projectPath, name: 'Alt' },
      { id: 'other-stop', ownerAgentId: 'other-agent', projectPath: otherProjectPath, name: 'Other' },
    ],
    routes: [
      { id: 'stale-route', ownerAgentId: 'stale-agent', projectPath, sourceId: 'stale-agent', targetId: 'stale-filter', condition: 'Immer', prompt: '' },
      { id: 'other-route', ownerAgentId: 'other-agent', projectPath: otherProjectPath, sourceId: 'other-agent', targetId: 'other-filter', condition: 'Immer', prompt: '' },
    ],
    positions: {
      'stale-agent:stale-agent': { x: 1, y: 1 },
      'other-agent:other-agent': { x: 2, y: 2 },
    },
    boardAgentIds: {
      'stale-agent': ['stale-agent'],
      'other-agent': ['other-agent'],
    },
    createId: () => `replacement-${++nextId}`,
  })

  assert.equal(topology.initials.some((item) => item.id === 'stale-initial'), false)
  assert.equal(topology.filters.some((item) => item.id === 'stale-filter'), false)
  assert.equal(topology.stops.some((item) => item.id === 'stale-stop'), false)
  assert.equal(topology.routes.some((item) => item.id === 'stale-route'), false)
  assert.equal('stale-agent' in topology.boardAgentIds, false)
  assert.equal('stale-agent:stale-agent' in topology.positions, false)
  assert.ok(topology.initials.some((item) => item.id === 'other-initial'))
  assert.ok(topology.filters.some((item) => item.id === 'other-filter'))
  assert.ok(topology.stops.some((item) => item.id === 'other-stop'))
  assert.ok(topology.routes.some((item) => item.id === 'other-route'))
  assert.deepEqual(topology.boardAgentIds['other-agent'], ['other-agent'])
  assert.deepEqual(topology.positions['other-agent:other-agent'], { x: 2, y: 2 })
})

test('does not create a technical error route from the manager back to itself', () => {
  const parsed = parseManagementTeamPlan(teamProposal)
  assert.ok(parsed)
  const projectPath = 'C:\\Projects\\team-test'
  const manager = { id: 'agent-ceo', name: 'CEO' }
  const plan = {
    ...parsed.plan,
    agents: [
      {
        name: 'CEO',
        role: 'Leitet das Team',
        prompt: 'Koordiniere das Team und entscheide bei Fehlern.',
        workflowStatuses: [MANAGEMENT_ERROR_STATUS_NAME],
      },
      ...parsed.plan.agents,
    ],
  }
  const agents = [
    manager,
    { id: 'agent-architect', name: 'Architekt' },
    { id: 'agent-developer', name: 'Entwickler' },
    { id: 'agent-qa', name: 'QA' },
  ]
  const statuses = plan.statusCommands.map((status, index) => ({
    id: `status-${index + 1}`,
    projectPath,
    name: status.name,
    description: status.meaning,
  }))
  let nextId = 0
  const topology = buildTeamTopology({
    plan,
    manager,
    agents,
    projectPath,
    statuses,
    initials: [],
    filters: [],
    stops: [],
    routes: [],
    positions: {},
    boardAgentIds: {},
    createId: () => `self-route-${++nextId}`,
  })

  assert.equal(
    topology.filters.some((filter) => filter.name === 'Fehler: CEO -> CEO'),
    false,
  )
  assert.equal(
    topology.routes.some((route) => route.sourceId === manager.id && route.targetId === manager.id),
    false,
  )
})
