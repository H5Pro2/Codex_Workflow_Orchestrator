import assert from 'node:assert/strict'
import test from 'node:test'
import { projectThreadExecutionParams, projectTurnExecutionParams } from './codex-sandbox.mjs'

test('project threads start with workspace write limited to the project', () => {
  const params = projectThreadExecutionParams('C:\\projects\\demo')
  assert.equal(params.sandbox, 'workspace-write')
  assert.equal(params.approvalPolicy, 'never')
  assert.match(params.cwd, /projects[\\/]demo$/)
})

test('existing project turns receive an explicit scoped workspace policy', () => {
  const params = projectTurnExecutionParams('C:\\projects\\demo')
  assert.equal(params.sandboxPolicy.type, 'workspaceWrite')
  assert.deepEqual(params.sandboxPolicy.writableRoots, [params.cwd])
  assert.equal(params.sandboxPolicy.networkAccess, false)
})
