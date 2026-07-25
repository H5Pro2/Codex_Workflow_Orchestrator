import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveConfiguredDeliveries } from './workflow-routing.ts'

const route = (id: string, sourceId: string, targetId: string) => ({
  id,
  sourceId,
  targetId,
  condition: '',
  prompt: '',
})

test('routes only the status selected by the validated protocol signal', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'ceo',
    result: 'Weiter an Frontend',
    resultStatusIds: ['forward'],
    routes: [
      route('ceo-filter', 'ceo', 'forward-filter'),
      route('filter-frontend', 'forward-filter', 'frontend'),
      route('ceo-error', 'ceo', 'error-filter'),
      route('error-worker', 'error-filter', 'worker'),
    ],
    statusFilters: [
      { id: 'forward-filter', statusId: 'forward' },
      { id: 'error-filter', statusId: 'error' },
    ],
    promptNodes: [],
    targetIds: new Set(['frontend', 'worker']),
    stopIds: new Set(),
  })
  assert.deepEqual(deliveries.map((delivery) => delivery.targetId), ['frontend'])
})

test('does not infer a route from prose or an unvalidated status', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'ceo',
    result: 'Bitte an Frontend weitergeben.',
    resultStatusIds: [],
    routes: [route('ceo-filter', 'ceo', 'forward-filter'), route('filter-frontend', 'forward-filter', 'frontend')],
    statusFilters: [{ id: 'forward-filter', statusId: 'forward' }],
    promptNodes: [],
    targetIds: new Set(['frontend']),
    stopIds: new Set(),
  })
  assert.deepEqual(deliveries, [])
})

test('resolves configured stop paths', () => {
  const deliveries = resolveConfiguredDeliveries({
    sourceId: 'qa',
    result: 'Abgeschlossen',
    resultStatusIds: ['done'],
    routes: [route('qa-filter', 'qa', 'done-filter'), route('filter-stop', 'done-filter', 'project-stop')],
    statusFilters: [{ id: 'done-filter', statusId: 'done' }],
    promptNodes: [],
    targetIds: new Set(),
    stopIds: new Set(['project-stop']),
  })
  assert.deepEqual(deliveries.map((delivery) => delivery.stopId), ['project-stop'])
})
