import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectForThread, threadBelongsToProject } from './codex-project.ts'

const original = { id: 'original', path: 'C:\\Codex\\new-chat' }
const assigned = { id: 'assigned', path: 'C:\\MCM' }

test('uses an explicit Codex project assignment before the original cwd', () => {
  const thread = { projectId: 'assigned', cwd: original.path }
  assert.equal(threadBelongsToProject(thread, assigned), true)
  assert.equal(threadBelongsToProject(thread, original), false)
  assert.equal(projectForThread(thread, [original, assigned]), assigned)
})

test('falls back to cwd for legacy threads without a project assignment', () => {
  assert.equal(threadBelongsToProject({ cwd: 'c:/mcm/' }, assigned), true)
})
