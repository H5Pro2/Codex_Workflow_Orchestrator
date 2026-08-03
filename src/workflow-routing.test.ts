import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  isTerminalIntervalSideBranch,
  resolveConfiguredDeliveries,
} from './workflow-routing.ts'

const route = (id: string, sourceId: string, targetId: string) => ({
  id,
  sourceId,
  targetId,
  condition: '',
  prompt: '',
})

test('routes a direct agent connection without hidden forwarding nodes', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'developer',
    result: 'Umsetzung fertig.',
    routes: [route('developer-reviewer', 'developer', 'reviewer')],
    promptNodes: [],
    targetIds: new Set(['reviewer']),
    stopIds: new Set(),
  })

  assert.deepEqual(deliveries.map((delivery) => delivery.targetId), ['reviewer'])
})

test('routes a forwarding prompt without a workflow status signal', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'analyst',
    result: 'Analyse abgeschlossen.',
    routes: [
      route('analyst-forward', 'analyst', 'forward-node'),
      { ...route('forward-researcher', 'forward-node', 'researcher'), sourceHandle: 'output' },
      { ...route('forward-helper', 'forward-node', 'helper'), sourceHandle: 'output' },
    ],
    promptNodes: [{
      id: 'forward-node',
      condition: 'Immer',
      prompt: 'Bearbeite die vorherige Antwort gemaess deiner Rolle weiter.',
    }],
    targetIds: new Set(['researcher', 'helper']),
    stopIds: new Set(),
  })

  assert.deepEqual(deliveries.map((delivery) => delivery.targetId), ['researcher', 'helper'])
})

test('ignores stale route conditions on visible forwarding paths', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'researcher',
    result: 'Ergebnis liegt vor.\n\n[Workflow-Status: Interner Workflow-Fehler]',
    routes: [
      route('researcher-forward', 'researcher', 'forward-node'),
      { ...route('forward-helper', 'forward-node', 'helper'), sourceHandle: 'output', condition: 'Alter Statusname' },
    ],
    promptNodes: [{
      id: 'forward-node',
      condition: '',
      prompt: 'Weitergeben.',
    }],
    targetIds: new Set(['helper']),
    stopIds: new Set(),
  })

  assert.deepEqual(deliveries.map((delivery) => delivery.targetId), ['helper'])
})

test('routes a forwarding interval through normal and interval outputs', () => {
  const routes = [
    route('agent-forward', 'agent', 'forward-node'),
    { ...route('forward-normal', 'forward-node', 'reviewer'), sourceHandle: 'output' },
    { ...route('forward-interval', 'forward-node', 'auditor'), sourceHandle: 'interval' },
  ]
  const resolveAt = (intervalCount: number) => resolveConfiguredDeliveries({
    sourceId: 'agent',
    result: 'Ergebnis',
    routes,
    promptNodes: [{ id: 'forward-node', condition: '', prompt: 'Weiter', interval: 5, intervalCount }],
    targetIds: new Set(['reviewer', 'auditor']),
    stopIds: new Set(),
  })

  assert.deepEqual(resolveAt(3).map((delivery) => ({
    targetId: delivery.targetId,
    branch: delivery.promptBranch,
    nextCount: delivery.promptNextCount,
  })), [{ targetId: 'reviewer', branch: 'normal', nextCount: 4 }])
  assert.deepEqual(resolveAt(4).map((delivery) => ({
    targetId: delivery.targetId,
    branch: delivery.promptBranch,
    nextCount: delivery.promptNextCount,
  })), [{ targetId: 'auditor', branch: 'interval', nextCount: 0 }])
})

test('routes a forwarding interval through both outputs when configured', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'agent',
    result: 'Ergebnis',
    routes: [
      route('agent-forward', 'agent', 'forward-node'),
      { ...route('forward-normal', 'forward-node', 'reviewer'), sourceHandle: 'output' },
      { ...route('forward-interval', 'forward-node', 'auditor'), sourceHandle: 'interval' },
    ],
    promptNodes: [{
      id: 'forward-node',
      condition: '',
      prompt: 'Weiter',
      interval: 5,
      intervalCount: 4,
      intervalMode: 'both',
      intervalPrompt: 'Pruefe als Stichprobe.',
    }],
    targetIds: new Set(['reviewer', 'auditor']),
    stopIds: new Set(),
  })

  assert.deepEqual(deliveries.map((delivery) => ({
    targetId: delivery.targetId,
    prompt: delivery.route.prompt,
    branch: delivery.promptBranch,
    nextCount: delivery.promptNextCount,
  })), [
    { targetId: 'reviewer', prompt: 'Weiter', branch: 'interval', nextCount: 0 },
    { targetId: 'auditor', prompt: 'Pruefe als Stichprobe.', branch: 'interval', nextCount: 0 },
  ])
})

test('routes a loop node to its configured target agent without a visible return edge', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'programmer',
    result: 'Implementierung abgeschlossen.',
    routes: [route('programmer-loop', 'programmer', 'return-loop')],
    promptNodes: [],
    loopNodes: [{ id: 'return-loop', targetAgentId: 'developer' }],
    targetIds: new Set(['developer']),
    stopIds: new Set(),
  })

  assert.deepEqual(deliveries.map((delivery) => ({
    targetId: delivery.targetId,
    loopNodeId: delivery.loopNodeId,
  })), [{ targetId: 'developer', loopNodeId: 'return-loop' }])
})

test('routes a loop node to all configured target agents', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'programmer',
    result: 'Implementierung abgeschlossen.',
    routes: [route('programmer-loop', 'programmer', 'return-loop')],
    promptNodes: [],
    loopNodes: [{
      id: 'return-loop',
      targetAgentId: 'developer',
      targetAgentIds: ['developer', 'reviewer'],
    }],
    targetIds: new Set(['developer', 'reviewer']),
    stopIds: new Set(),
  })

  assert.deepEqual(deliveries.map((delivery) => ({
    targetId: delivery.targetId,
    loopNodeId: delivery.loopNodeId,
  })), [
    { targetId: 'developer', loopNodeId: 'return-loop' },
    { targetId: 'reviewer', loopNodeId: 'return-loop' },
  ])
})

test('routes a loop node to target agents and an explicit stop output', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'programmer',
    result: 'Implementierung abgeschlossen.',
    routes: [
      route('programmer-loop', 'programmer', 'return-loop'),
      { ...route('loop-stop', 'return-loop', 'project-stop'), sourceHandle: 'output' },
    ],
    promptNodes: [],
    loopNodes: [{ id: 'return-loop', targetAgentId: 'developer' }],
    targetIds: new Set(['developer']),
    stopIds: new Set(['project-stop']),
  })

  assert.deepEqual(deliveries.map((delivery) => ({
    targetId: delivery.targetId,
    stopId: delivery.stopId,
    loopNodeId: delivery.loopNodeId,
  })), [
    { targetId: 'developer', stopId: undefined, loopNodeId: 'return-loop' },
    { targetId: undefined, stopId: 'project-stop', loopNodeId: 'return-loop' },
  ])
})

test('routes a loop output through an explicit forwarding node', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'programmer',
    result: 'Implementierung abgeschlossen.',
    routes: [
      route('programmer-loop', 'programmer', 'return-loop'),
      { ...route('loop-forward', 'return-loop', 'forward-node'), sourceHandle: 'output' },
      { ...route('forward-analyst', 'forward-node', 'analyst'), sourceHandle: 'output' },
    ],
    promptNodes: [{ id: 'forward-node', condition: '', prompt: 'Abschluss prüfen.' }],
    loopNodes: [{ id: 'return-loop', targetAgentId: 'developer' }],
    targetIds: new Set(['developer', 'analyst']),
    stopIds: new Set(),
  })

  assert.deepEqual(deliveries.map((delivery) => ({
    targetId: delivery.targetId,
    promptNodeId: delivery.promptNodeId,
    loopNodeId: delivery.loopNodeId,
  })), [
    { targetId: 'developer', promptNodeId: undefined, loopNodeId: 'return-loop' },
    { targetId: 'analyst', promptNodeId: 'forward-node', loopNodeId: 'return-loop' },
  ])
})

test('routes configured stop paths', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'qa',
    result: 'Abgeschlossen',
    routes: [route('qa-stop', 'qa', 'project-stop')],
    promptNodes: [],
    targetIds: new Set(),
    stopIds: new Set(['project-stop']),
  })

  assert.deepEqual(deliveries.map((delivery) => delivery.stopId), ['project-stop'])
})

test('deduplicates multiple matching routes to the same target', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'researcher',
    result: 'Pruefung und Weitergabe',
    routes: [
      route('researcher-forward-a', 'researcher', 'forward-a'),
      route('forward-a-reviewer', 'forward-a', 'reviewer'),
      route('researcher-forward-b', 'researcher', 'forward-b'),
      route('forward-b-reviewer', 'forward-b', 'reviewer'),
    ],
    promptNodes: [
      { id: 'forward-a', condition: '', prompt: 'Weiter' },
      { id: 'forward-b', condition: '', prompt: 'Weiter' },
    ],
    targetIds: new Set(['reviewer']),
    stopIds: new Set(),
  })

  assert.deepEqual(deliveries.map((delivery) => delivery.targetId), ['reviewer'])
})

test('terminal interval branch is non-blocking only for interval targets without outgoing routes', () => {
  const routes = [
    route('forward-normal', 'forward-node', 'reviewer'),
    { ...route('forward-interval', 'forward-node', 'auditor'), sourceHandle: 'interval' },
  ]

  assert.equal(isTerminalIntervalSideBranch({
    agentId: 'auditor',
    activeRouteCount: 0,
    routes,
  }), true)
  assert.equal(isTerminalIntervalSideBranch({
    agentId: 'reviewer',
    activeRouteCount: 0,
    routes,
  }), false)
  assert.equal(isTerminalIntervalSideBranch({
    agentId: 'auditor',
    activeRouteCount: 1,
    routes,
  }), false)
})
