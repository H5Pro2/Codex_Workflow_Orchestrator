import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dequeueDelivery, enqueueDelivery, normalizeDeliveryQueue } from './delivery-queue.ts'
import { decideWorkflowContinuation } from './workflow-decision.ts'
import { parseWorkflowSignal } from './workflow-protocol.ts'
import { resolveConfiguredDeliveries } from './workflow-routing.ts'

const statuses = [
  { id: 'done', name: 'Projekt abgeschlossen' },
]
const routes = [
  { id: 'ceo-forward', sourceId: 'ceo', targetId: 'forward-node', condition: '', prompt: '' },
  { id: 'forward-frontend', sourceId: 'forward-node', targetId: 'frontend', condition: '', prompt: '' },
  { id: 'frontend-stop', sourceId: 'frontend', targetId: 'project-stop', condition: '', prompt: '' },
]
const promptNodes = [
  { id: 'forward-node', condition: '', prompt: 'Weiter bearbeiten.' },
]

function resolve(sourceId: string, result: string) {
  const signal = parseWorkflowSignal(result, statuses)
  const deliveries = resolveConfiguredDeliveries({
    sourceId,
    result,
    routes,
    promptNodes,
    targetIds: new Set(['ceo', 'frontend']),
    stopIds: new Set(['project-stop']),
  })
  return { signal, deliveries }
}

test('runs a statusless forwarding handoff through a specialist to the configured stop', () => {
  const delegated = resolve('ceo', 'Arbeitsauftrag vorbereitet.')
  assert.equal(decideWorkflowContinuation({
    signal: delegated.signal,
    deliveryCount: delegated.deliveries.length,
    activeRouteCount: 1,
  }).action, 'continue')
  assert.deepEqual(delegated.deliveries.map((delivery) => delivery.targetId), ['frontend'])

  const completed = resolve('frontend', 'Umsetzung geprueft.\n[Workflow-Status: Projekt abgeschlossen]')
  assert.deepEqual(completed.deliveries.map((delivery) => delivery.stopId), ['project-stop'])
})

test('stops safely on an incomplete CEO answer without a forwarding route', () => {
  const signal = parseWorkflowSignal('Ich wuerde den Frontend-Agenten einsetzen.', statuses)
  const decision = decideWorkflowContinuation({
    signal,
    deliveryCount: 0,
    activeRouteCount: 0,
  })
  assert.equal(decision.action, 'stop')
  assert.match(decision.reason, /keine ausgehende Workflow-Verbindung/)
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
