import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  insertProjectGoalText,
  projectGoalForProject,
  projectGoalInstruction,
  type ProjectGoal,
} from './project-goal.ts'

const goals: ProjectGoal[] = [
  { projectPath: 'C:\\MCM', goal: 'MCM nachvollziehbar erforschen.' },
  { projectPath: 'C:\\DIO', goal: 'MINI_DIO reproduzierbar prüfen.' },
]

test('selects the goal only for the current project', () => {
  assert.equal(projectGoalForProject(goals, 'c:/mcm/'), 'MCM nachvollziehbar erforschen.')
  assert.equal(projectGoalForProject(goals, 'C:\\Other'), '')
})

test('builds non-executable project orientation', () => {
  const instruction = projectGoalInstruction('  MCM nachvollziehbar erforschen.  ')
  assert.match(instruction, /nur Orientierung und Qualitätskontrolle/)
  assert.match(instruction, /keine eigenständig auszuführende Aufgabe/)
  assert.match(instruction, /MCM nachvollziehbar erforschen/)
  assert.equal(projectGoalInstruction('  '), '')
})

test('inserts pasted project goal text without changing whitespace', () => {
  assert.deepEqual(
    insertProjectGoalText('VorherNachher', '  erste Zeile\n\nzweite Zeile  ', 6, 6),
    {
      value: 'Vorher  erste Zeile\n\nzweite Zeile  Nachher',
      cursor: 35,
    },
  )
})
