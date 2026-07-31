import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

let pendingAssignment = Promise.resolve()

function samePath(left, right) {
  return resolve(left).replace(/^\\\\\?\\/, '').toLocaleLowerCase('de-DE') ===
    resolve(right).replace(/^\\\\\?\\/, '').toLocaleLowerCase('de-DE')
}

export function assignThreadToLocalProject({ stateFile, threadId, projectId, cwd }) {
  const operation = pendingAssignment.then(async () => {
    const state = JSON.parse(await readFile(stateFile, 'utf8'))
    const project = state?.['local-projects']?.[projectId]
    const projectPath = Array.isArray(project?.rootPaths) ? project.rootPaths[0] : ''
    if (!project || project.id !== projectId || typeof projectPath !== 'string' || !samePath(projectPath, cwd)) {
      throw new Error('Die Codex-Projektzuordnung passt nicht zum ausgewählten Projektordner.')
    }

    const assignments = state['thread-project-assignments'] ?? {}
    state['thread-project-assignments'] = {
      ...assignments,
      [threadId]: {
        projectKind: 'local',
        projectId,
        path: projectPath,
        cwd: projectPath,
        pendingCoreUpdate: false,
      },
    }

    const temporaryFile = `${stateFile}.${process.pid}.${randomUUID()}.tmp`
    await writeFile(temporaryFile, JSON.stringify(state, null, 2), 'utf8')
    await rename(temporaryFile, stateFile)
    return state['thread-project-assignments'][threadId]
  })

  pendingAssignment = operation.then(
    () => undefined,
    () => undefined,
  )
  return operation
}
