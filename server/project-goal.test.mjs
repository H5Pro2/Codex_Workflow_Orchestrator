import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  PROJECT_GOAL_MAX_LENGTH,
  normalizeProjectGoal,
  projectGoalFile,
  readProjectGoal,
  writeProjectGoal,
} from './project-goal.mjs'

test('normalizes and limits a project goal', () => {
  assert.equal(normalizeProjectGoal('  Gemeinsames Forschungsziel  '), 'Gemeinsames Forschungsziel')
  assert.throws(() => normalizeProjectGoal(null), /als Text/)
  assert.throws(() => normalizeProjectGoal('x'.repeat(PROJECT_GOAL_MAX_LENGTH + 1)), /höchstens/)
})

test('stores one project goal inside the selected project', async () => {
  const projectPath = await mkdtemp(join(tmpdir(), 'orchestrator-goal-'))
  try {
    assert.equal(await readProjectGoal(projectPath), '')
    assert.equal(await writeProjectGoal(projectPath, 'Nachweisbare MCM-Forschung'), 'Nachweisbare MCM-Forschung')
    assert.equal(await readProjectGoal(projectPath), 'Nachweisbare MCM-Forschung')
    const stored = JSON.parse(await readFile(projectGoalFile(projectPath), 'utf8'))
    assert.deepEqual(stored, { version: 1, goal: 'Nachweisbare MCM-Forschung' })
    assert.equal(await writeProjectGoal(projectPath, '  '), '')
    assert.equal(await readProjectGoal(projectPath), '')
  } finally {
    await rm(projectPath, { recursive: true, force: true })
  }
})
