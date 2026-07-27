import assert from 'node:assert/strict'
import test from 'node:test'
import { compareGitWorkspaces } from './git-workspace-changes.mjs'

test('reports only files whose workspace state changed during the turn', () => {
  const before = {
    root: 'C:\\repo',
    entries: {
      'already-dirty.ts': { status: ' M', fingerprint: '12:100' },
      'edited-again.ts': { status: ' M', fingerprint: '14:100' },
      'removed.md': { status: ' M', fingerprint: '8:100' },
    },
  }
  const after = {
    root: 'C:\\repo',
    entries: {
      'already-dirty.ts': { status: ' M', fingerprint: '12:100' },
      'edited-again.ts': { status: ' M', fingerprint: '18:200' },
      'new-file.ts': { status: '??', fingerprint: '9:200' },
    },
  }

  assert.deepEqual(compareGitWorkspaces(before, after), [
    { path: 'edited-again.ts', kind: 'modified' },
    { path: 'new-file.ts', kind: 'added' },
    { path: 'removed.md', kind: 'modified' },
  ])
})

test('returns no changes when no git snapshot is available', () => {
  assert.deepEqual(compareGitWorkspaces(null, null), [])
})
