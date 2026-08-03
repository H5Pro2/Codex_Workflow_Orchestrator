import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pruneWorkflowBoardAgentIds, pruneWorkflowBoardNodeIds, pruneWorkflowPositions } from './workflow-state.ts'

test('removes legacy agent dashboard references', () => {
  assert.deepEqual(pruneWorkflowBoardAgentIds({
    ceo: ['developer', 'missing', 'developer'],
    missing: ['ceo'],
  }, ['ceo', 'developer']), {})
})

test('preserves project dashboard references while pruning stale members', () => {
  assert.deepEqual(pruneWorkflowBoardAgentIds({
    'project:C:\\fixture-project': ['ceo', 'developer', 'missing', 'developer'],
  }, ['ceo', 'developer']), {
    'project:C:\\fixture-project': ['ceo', 'developer'],
  })
})

test('prunes explicit dashboard tool references without inferring tools from agents', () => {
  assert.deepEqual(pruneWorkflowBoardNodeIds({
    'project:C:\\fixture-project': ['forward', 'missing', 'forward'],
    'project:C:\\empty-project': ['missing'],
  }, ['forward', 'initial']), {
    'project:C:\\fixture-project': ['forward'],
  })
})

test('removes legacy agent dashboard positions', () => {
  assert.deepEqual(pruneWorkflowPositions({
    'ceo:ceo': { x: 1, y: 2 },
    'ceo:missing': { x: 3, y: 4 },
    'missing:ceo': { x: 5, y: 6 },
  }, ['ceo'], ['ceo']), {})
})

test('preserves project dashboard positions with Windows paths', () => {
  assert.deepEqual(pruneWorkflowPositions({
    'project:C:\\fixture-project:ceo': { x: 1, y: 2 },
    'project:C:\\fixture-project:missing': { x: 3, y: 4 },
  }, ['ceo'], ['ceo']), {
    'project:C:\\fixture-project:ceo': { x: 1, y: 2 },
  })
})

test('preserves project dashboard positions for return jump nodes', () => {
  assert.deepEqual(pruneWorkflowPositions({
    'project:C:\\fixture-project:loop-1': { x: 720, y: 330 },
    'project:C:\\fixture-project:agent-1': { x: 120, y: 80 },
  }, ['agent-1'], ['agent-1', 'loop-1']), {
    'project:C:\\fixture-project:loop-1': { x: 720, y: 330 },
    'project:C:\\fixture-project:agent-1': { x: 120, y: 80 },
  })
})
