import assert from 'node:assert/strict'
import { test } from 'node:test'
import { explicitAgentStatusIds } from './agent-status-assignment.ts'

test('keeps only explicit agent workflow statuses', () => {
  assert.deepEqual(explicitAgentStatusIds(['review', 'review', '', 42]), ['review'])
  assert.deepEqual(explicitAgentStatusIds(null), [])
  assert.deepEqual(explicitAgentStatusIds(undefined), [])
})
