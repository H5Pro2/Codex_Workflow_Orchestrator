import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { assignThreadToLocalProject } from './codex-project-assignment.mjs'

test('assigns a newly created thread to its existing Codex project', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-project-assignment-'))
  const stateFile = join(directory, 'state.json')
  await writeFile(stateFile, JSON.stringify({
    untouched: { value: 7 },
    'local-projects': {
      mcm: { id: 'mcm', name: 'MCM', rootPaths: ['C:\\Projects\\MCM'] },
    },
    'thread-project-assignments': {
      existing: { projectKind: 'local', projectId: 'mcm', cwd: 'C:\\Projects\\MCM' },
    },
  }), 'utf8')

  const assignment = await assignThreadToLocalProject({
    stateFile,
    threadId: 'new-thread',
    projectId: 'mcm',
    cwd: 'C:\\Projects\\MCM',
  })
  const persisted = JSON.parse(await readFile(stateFile, 'utf8'))

  assert.equal(assignment.projectId, 'mcm')
  assert.equal(persisted['thread-project-assignments']['new-thread'].cwd, 'C:\\Projects\\MCM')
  assert.equal(persisted['thread-project-assignments'].existing.projectId, 'mcm')
  assert.deepEqual(persisted.untouched, { value: 7 })
})

test('rejects a project id whose registered path differs from the requested cwd', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'codex-project-assignment-'))
  const stateFile = join(directory, 'state.json')
  await writeFile(stateFile, JSON.stringify({
    'local-projects': {
      mcm: { id: 'mcm', name: 'MCM', rootPaths: ['C:\\Projects\\MCM'] },
    },
  }), 'utf8')

  await assert.rejects(
    assignThreadToLocalProject({
      stateFile,
      threadId: 'new-thread',
      projectId: 'mcm',
      cwd: 'C:\\Projects\\Other',
    }),
    /passt nicht/u,
  )
})
