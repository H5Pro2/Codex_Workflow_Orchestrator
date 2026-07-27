import assert from 'node:assert/strict'
import test from 'node:test'
import {
  workflowDeliveryKey,
  wouldRepeatWorkflowCycle,
} from './workflow-loop-guard.ts'

test('stops a repeated two-agent status cycle before its third round', () => {
  const leadToCheck = workflowDeliveryKey({ sourceId: 'lead', targetId: 'check', statusIds: ['review'] })
  const checkToLead = workflowDeliveryKey({ sourceId: 'check', targetId: 'lead', statusIds: ['result'] })

  assert.equal(wouldRepeatWorkflowCycle([
    leadToCheck,
    checkToLead,
    leadToCheck,
    checkToLead,
  ], leadToCheck), true)
})

test('allows a workflow that advances to a different status path', () => {
  assert.equal(wouldRepeatWorkflowCycle([
    'lead->check:review',
    'check->lead:result',
    'lead->check:review',
    'check->lead:result',
  ], 'lead->developer:implement'), false)
})

test('allows the same route for a new task', () => {
  const firstTask = workflowDeliveryKey({
    sourceId: 'lead',
    targetId: 'developer',
    statusIds: ['research'],
    taskSignature: 'research-032',
  })
  const nextTask = workflowDeliveryKey({
    sourceId: 'lead',
    targetId: 'developer',
    statusIds: ['research'],
    taskSignature: 'research-033',
  })

  assert.equal(wouldRepeatWorkflowCycle([
    firstTask,
    firstTask,
  ], nextTask), false)
})
