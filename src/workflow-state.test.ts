import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pruneWorkflowBoardAgentIds, pruneWorkflowPositions } from './workflow-state.ts'

test('removes stale dashboard references and preserves the dashboard owner', () => {
  assert.deepEqual(pruneWorkflowBoardAgentIds({
    ceo: ['developer', 'missing', 'developer'],
    missing: ['ceo'],
  }, ['ceo', 'developer']), {
    ceo: ['ceo', 'developer'],
  })
})

test('removes positions whose owner or node no longer exists', () => {
  assert.deepEqual(pruneWorkflowPositions({
    'ceo:ceo': { x: 1, y: 2 },
    'ceo:missing': { x: 3, y: 4 },
    'missing:ceo': { x: 5, y: 6 },
  }, ['ceo'], ['ceo']), {
    'ceo:ceo': { x: 1, y: 2 },
  })
})
