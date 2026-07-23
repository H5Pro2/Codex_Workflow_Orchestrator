import assert from 'node:assert/strict'
import { test } from 'node:test'
import { summarizeDeliveryAttempts } from './delivery-outcome.ts'

test('keeps a failed delivery from looking successful', () => {
  assert.deepEqual(
    summarizeDeliveryAttempts([
      { targetName: 'Entwickler', delivered: false },
    ]),
    {
      deliveredTargets: [],
      delivered: false,
      sourceStatus: 'rueckfrage',
    },
  )
})

test('reports only targets that accepted a connector turn', () => {
  assert.deepEqual(
    summarizeDeliveryAttempts([
      { targetName: 'Entwickler', delivered: true },
      { targetName: 'QA', delivered: false },
    ]),
    {
      deliveredTargets: ['Entwickler'],
      delivered: true,
      sourceStatus: 'weitergegeben',
    },
  )
})
