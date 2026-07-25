import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dequeueDelivery, enqueueDelivery, normalizeDeliveryQueue } from './delivery-queue.ts'
import { decideWorkflowContinuation } from './workflow-decision.ts'
import { parseWorkflowSignal } from './workflow-protocol.ts'
import { resolveConfiguredDeliveries } from './workflow-routing.ts'

const statuses = [
  { id: 'forward', name: 'Weiterleitung' },
  { id: 'done', name: 'Projekt abgeschlossen' },
]
const routes = [
  { id: 'ceo-filter', sourceId: 'ceo', targetId: 'forward-filter', condition: '', prompt: '' },
  { id: 'filter-frontend', sourceId: 'forward-filter', targetId: 'frontend', condition: '', prompt: '' },
  { id: 'frontend-filter', sourceId: 'frontend', targetId: 'done-filter', condition: '', prompt: '' },
  { id: 'filter-stop', sourceId: 'done-filter', targetId: 'project-stop', condition: '', prompt: '' },
]
const statusFilters = [
  { id: 'forward-filter', statusId: 'forward' },
  { id: 'done-filter', statusId: 'done' },
]

function resolve(sourceId: string, result: string) {
  const signal = parseWorkflowSignal(result, statuses)
  const deliveries = resolveConfiguredDeliveries({
    sourceId,
    result,
    resultStatusIds: signal.statusIds,
    routes,
    statusFilters,
    promptNodes: [],
    targetIds: new Set(['ceo', 'frontend']),
    stopIds: new Set(['project-stop']),
  })
  return { signal, deliveries }
}

test('runs a validated CEO delegation through a specialist to the configured stop', () => {
  const delegated = resolve('ceo', 'Arbeitsauftrag vorbereitet.\n[Workflow-Status: Weiterleitung]')
  assert.equal(decideWorkflowContinuation({
    signal: delegated.signal,
    deliveryCount: delegated.deliveries.length,
    managementObservation: false,
    activeRouteCount: 1,
  }).action, 'continue')
  assert.deepEqual(delegated.deliveries.map((delivery) => delivery.targetId), ['frontend'])

  const completed = resolve('frontend', 'Umsetzung geprüft.\n[Workflow-Status: Projekt abgeschlossen]')
  assert.deepEqual(completed.deliveries.map((delivery) => delivery.stopId), ['project-stop'])
})

test('stops safely on an incomplete CEO answer instead of guessing a target', () => {
  const incomplete = resolve('ceo', 'Ich würde den Frontend-Agenten einsetzen.')
  const decision = decideWorkflowContinuation({
    signal: incomplete.signal,
    deliveryCount: incomplete.deliveries.length,
    managementObservation: false,
    activeRouteCount: 1,
  })
  assert.equal(decision.action, 'stop')
  assert.match(decision.reason, /keinen Workflow-Status/)
})

test('continues parallel handoffs in order after queue serialization and restart', () => {
  let queue = enqueueDelivery({}, 'qa', 'frontend')
  queue = enqueueDelivery(queue, 'qa', 'designer')
  const restartedQueue = normalizeDeliveryQueue(JSON.parse(JSON.stringify(queue)))
  const first = dequeueDelivery(restartedQueue, 'qa')
  const second = dequeueDelivery(first.queue, 'qa')
  assert.deepEqual([first.sourceId, second.sourceId], ['frontend', 'designer'])
  assert.deepEqual(second.queue, {})
})
