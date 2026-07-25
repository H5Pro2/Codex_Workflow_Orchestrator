import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyThreadProjectAssignments, savedProjectsFromState } from './codex-project-state.mjs'

const state = {
  'local-projects': {
    project: { id: 'project', name: 'MCM', rootPaths: ['C:\\MCM'] },
  },
  'project-order': ['project'],
  'thread-project-assignments': {
    moved: { projectKind: 'local', projectId: 'project', cwd: 'C:\\MCM', pendingCoreUpdate: true },
  },
}

test('reads saved Codex projects in their configured order', () => {
  assert.deepEqual(savedProjectsFromState(state), [{ id: 'project', label: 'MCM', path: 'C:\\MCM' }])
})

test('keeps the original thread cwd and adds a later project assignment', () => {
  assert.deepEqual(applyThreadProjectAssignments([
    { id: 'moved', cwd: 'C:\\Codex\\new-chat' },
    { id: 'unassigned', cwd: 'C:\\Legacy' },
  ], state, savedProjectsFromState(state)), [
    {
      id: 'moved',
      cwd: 'C:\\Codex\\new-chat',
      projectId: 'project',
      projectPath: 'C:\\MCM',
      assignedCwd: 'C:\\MCM',
      projectAssignmentPending: true,
    },
    { id: 'unassigned', cwd: 'C:\\Legacy' },
  ])
})
