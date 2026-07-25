import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

export const PROJECT_GOAL_MAX_LENGTH = 4000

export function projectGoalFile(projectPath) {
  return join(resolve(projectPath), '.codex-orchestrator', 'project-goal.json')
}

export function normalizeProjectGoal(value) {
  if (typeof value !== 'string') {
    throw new Error('Das Projektziel muss als Text angegeben werden.')
  }
  const goal = value.trim()
  if (goal.length > PROJECT_GOAL_MAX_LENGTH) {
    throw new Error(`Das Projektziel darf höchstens ${PROJECT_GOAL_MAX_LENGTH} Zeichen enthalten.`)
  }
  return goal
}

export async function readProjectGoal(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) return ''
  try {
    const payload = JSON.parse(await readFile(projectGoalFile(projectPath), 'utf8'))
    return normalizeProjectGoal(payload?.goal ?? '')
  } catch (error) {
    if (error?.code === 'ENOENT') return ''
    throw error
  }
}

export async function writeProjectGoal(projectPath, value) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    throw new Error('Projektpfad ist erforderlich.')
  }
  const goal = normalizeProjectGoal(value)
  const filePath = projectGoalFile(projectPath)
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify({ version: 1, goal }, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, filePath)
  return goal
}
