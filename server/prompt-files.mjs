import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'

function safePromptFileName(fileName) {
  const requested = typeof fileName === 'string' ? fileName.trim() : ''
  const safe = basename(requested)
  if (!safe || safe !== requested) throw new Error('Ein gültiger Dateiname ist erforderlich.')
  return safe.toLocaleLowerCase('de-DE').endsWith('.md') ? safe : `${safe}.md`
}

function safePromptAgentId(agentId) {
  const requested = typeof agentId === 'string' ? agentId.trim() : ''
  const safe = requested.replace(/[^a-zA-Z0-9_-]/g, '')
  if (!safe || safe !== requested) throw new Error('Eine gültige Agenten-ID ist erforderlich.')
  return safe
}

export function promptContentSha256(content) {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

export async function writeVerifiedPromptFile({ projectPath, agentId, fileName, content }) {
  const root = resolve(projectPath)
  const directory = join(root, '.codex-orchestrator', 'prompts', safePromptAgentId(agentId))
  const targetPath = join(directory, safePromptFileName(fileName))
  const temporaryPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`

  await mkdir(directory, { recursive: true })
  try {
    await writeFile(temporaryPath, content, 'utf8')
    await rename(temporaryPath, targetPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }

  const persistedContent = await readFile(targetPath, 'utf8')
  if (persistedContent !== content) {
    throw new Error('Die Prompt-Datei konnte nach dem Speichern nicht verifiziert werden.')
  }
  return {
    path: targetPath,
    relativePath: relative(root, targetPath).replaceAll('\\', '/'),
    sha256: promptContentSha256(persistedContent),
  }
}

export async function deletePromptDirectory({ projectPath, agentId }) {
  const root = resolve(projectPath)
  const directory = join(root, '.codex-orchestrator', 'prompts', safePromptAgentId(agentId))
  await rm(directory, { recursive: true, force: true })
  return {
    path: directory,
    relativePath: relative(root, directory).replaceAll('\\', '/'),
  }
}
