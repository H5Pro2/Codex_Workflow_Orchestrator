import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  PROJECT_GOAL_MAX_LENGTH,
  assertUserProjectGoalWriteSource,
  normalizeProjectGoal,
  projectGoalFile,
  readProjectGoal,
  writeProjectGoal,
} from './project-goal.mjs'

test('allows project goal writes only from an explicit user action', () => {
  assert.doesNotThrow(() => assertUserProjectGoalWriteSource('user'))
  assert.throws(() => assertUserProjectGoalWriteSource(undefined), /ausschließlich durch eine Benutzeraktion/)
  assert.throws(() => assertUserProjectGoalWriteSource('agent'), /ausschließlich durch eine Benutzeraktion/)
})

test('normalizes and limits a project goal', () => {
  assert.equal(
    normalizeProjectGoal('  Gemeinsames\n\nForschungsziel  '),
    '  Gemeinsames\n\nForschungsziel  ',
  )
  assert.throws(() => normalizeProjectGoal(null), /als Text/)
  assert.throws(() => normalizeProjectGoal('x'.repeat(PROJECT_GOAL_MAX_LENGTH + 1)), /höchstens/)
})

test('stores one project goal inside the selected project', async () => {
  const projectPath = await mkdtemp(join(tmpdir(), 'orchestrator-goal-'))
  try {
    assert.equal(await readProjectGoal(projectPath), '')
    const formattedGoal = '  Nachweisbare MCM-Forschung\n\nmit genauer Formatierung  '
    assert.equal(await writeProjectGoal(projectPath, formattedGoal), formattedGoal)
    assert.equal(await readProjectGoal(projectPath), formattedGoal)
    const stored = JSON.parse(await readFile(projectGoalFile(projectPath), 'utf8'))
    assert.deepEqual(stored, { version: 1, goal: formattedGoal })
    assert.equal(await writeProjectGoal(projectPath, ''), '')
    assert.equal(await readProjectGoal(projectPath), '')
  } finally {
    await rm(projectPath, { recursive: true, force: true })
  }
})
