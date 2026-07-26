import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeAgentWebAccess,
  PROJECT_WORKSPACE_DIRECTORY,
  projectThreadExecutionParams,
  projectTurnExecutionParams,
  projectWorkspacePath,
} from './codex-sandbox.mjs'

test('project threads start with workspace write limited to the project', () => {
  const params = projectThreadExecutionParams('C:\\projects\\demo')
  assert.equal(params.sandbox, 'workspace-write')
  assert.equal(params.approvalPolicy, 'never')
  assert.match(params.cwd, /projects[\\/]demo$/)
})

test('existing project turns receive an explicit scoped workspace policy', () => {
  const params = projectTurnExecutionParams('C:\\projects\\demo')
  assert.equal(params.cwd, projectWorkspacePath('C:\\projects\\demo'))
  assert.match(params.cwd, new RegExp(`${PROJECT_WORKSPACE_DIRECTORY}$`))
  assert.equal(params.sandboxPolicy.type, 'workspaceWrite')
  assert.deepEqual(params.sandboxPolicy.writableRoots, [params.cwd])
  assert.equal(params.sandboxPolicy.networkAccess, false)
})

test('agent web access changes network and approval policy without widening workspace writes', () => {
  const prompted = projectTurnExecutionParams('C:\\projects\\demo', 'prompt')
  const allowed = projectTurnExecutionParams('C:\\projects\\demo', 'allowed')

  assert.equal(prompted.approvalPolicy, 'on-request')
  assert.equal(prompted.sandboxPolicy.networkAccess, false)
  assert.deepEqual(prompted.sandboxPolicy.writableRoots, [prompted.cwd])
  assert.equal(allowed.approvalPolicy, 'never')
  assert.equal(allowed.sandboxPolicy.networkAccess, true)
  assert.deepEqual(allowed.sandboxPolicy.writableRoots, [allowed.cwd])
})

test('unknown agent web access remains disabled', () => {
  assert.equal(normalizeAgentWebAccess('unrestricted'), 'off')
  assert.equal(projectTurnExecutionParams('C:\\projects\\demo', 'unrestricted').sandboxPolicy.networkAccess, false)
})
