import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_WORKFLOW_LOOPS,
  normalizeWorkflowLoopCount,
  normalizeWorkflowLoopCounts,
  setWorkflowLoopCount,
  workflowLoopCountForProject,
} from './workflow-loop.ts'

test('normalizes workflow loop counts to a safe range', () => {
  assert.equal(normalizeWorkflowLoopCount(0), 1)
  assert.equal(normalizeWorkflowLoopCount('5'), 5)
  assert.equal(normalizeWorkflowLoopCount(1000), MAX_WORKFLOW_LOOPS)
  assert.equal(normalizeWorkflowLoopCount('invalid'), 1)
})

test('stores loop counts independently for each project', () => {
  const counts = setWorkflowLoopCount({ first: 2 }, 'second', 4)
  assert.equal(workflowLoopCountForProject(counts, 'first'), 2)
  assert.equal(workflowLoopCountForProject(counts, 'second'), 4)
  assert.equal(workflowLoopCountForProject(counts, 'missing'), 1)
})

test('reads loop counts from stable project aliases', () => {
  assert.equal(workflowLoopCountForProject({ 'C:\\Project': 6 }, 'project-id', ['C:\\Project']), 6)
  assert.equal(workflowLoopCountForProject({ 'path:C:\\Project': 7 }, 'project-id', ['C:\\Project', 'path:C:\\Project']), 7)
})

test('stores loop counts under project id and stable aliases', () => {
  const counts = setWorkflowLoopCount({}, 'project-id', 8, ['C:\\Project', 'path:C:\\Project'])

  assert.equal(counts['project-id'], 8)
  assert.equal(counts['C:\\Project'], 8)
  assert.equal(counts['path:C:\\Project'], 8)
})

test('normalizes persisted workflow loop settings', () => {
  assert.deepEqual(normalizeWorkflowLoopCounts({ first: '3', second: -4 }), {
    first: 3,
    second: 1,
  })
})
