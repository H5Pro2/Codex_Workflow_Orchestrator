import assert from 'node:assert/strict'
import test from 'node:test'
import { wouldCompleteWorkflowCycleOnReturn } from './workflow-cycle-boundary.ts'
import {
  beginWorkflowRun,
  appendWorkflowRunEntry,
  normalizeWorkflowRuntime,
  workflowRunEntry,
} from './workflow-runtime.ts'

const initialAgentIds = new Set(['initial'])

test('does not complete a cycle on the initial agent outbound handoff', () => {
  const first = beginWorkflowRun(normalizeWorkflowRuntime(null), 'C:\\Project', '2026-01-01T00:00:00Z', 'run-1')

  assert.equal(wouldCompleteWorkflowCycleOnReturn({
    run: first.run,
    sourceAgentId: 'initial',
    targetAgentIds: ['helper'],
    initialAgentIds,
  }), false)
})

test('completes a cycle when a previously reached downstream agent returns to the initial agent', () => {
  const first = beginWorkflowRun(normalizeWorkflowRuntime(null), 'C:\\Project', '2026-01-01T00:00:00Z', 'run-1')
  const runtime = appendWorkflowRunEntry(
    first.runtime,
    'C:\\Project',
    workflowRunEntry('handoff-delivered', {
      agentId: 'initial',
      targetAgentIds: ['helper'],
      detail: 'Initial -> Helper',
    }),
  )

  assert.equal(wouldCompleteWorkflowCycleOnReturn({
    run: runtime.runs[0],
    sourceAgentId: 'helper',
    targetAgentIds: ['initial'],
    initialAgentIds,
  }), true)
})

test('does not complete a cycle if the source was not reached in the active run', () => {
  const first = beginWorkflowRun(normalizeWorkflowRuntime(null), 'C:\\Project', '2026-01-01T00:00:00Z', 'run-1')

  assert.equal(wouldCompleteWorkflowCycleOnReturn({
    run: first.run,
    sourceAgentId: 'helper',
    targetAgentIds: ['initial'],
    initialAgentIds,
  }), false)
})

test('does not complete a cycle without an active run', () => {
  assert.equal(wouldCompleteWorkflowCycleOnReturn({
    run: null,
    sourceAgentId: 'helper',
    targetAgentIds: ['initial'],
    initialAgentIds,
  }), false)
})
