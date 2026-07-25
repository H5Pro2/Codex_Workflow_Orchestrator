import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { projectWorkspacePath } from './codex-sandbox.mjs'

const SOURCE_TYPES = new Set(['folder', 'repository', 'file', 'url'])

export function knowledgeSourcesFile(projectPath) {
  return join(resolve(projectPath), '.codex-orchestrator', 'knowledge-sources.json')
}

export function normalizeKnowledgeSources(value) {
  if (!Array.isArray(value)) return []

  const ids = new Set()
  return value.flatMap((source) => {
    const id = typeof source?.id === 'string' ? source.id.trim() : ''
    const name = typeof source?.name === 'string' ? source.name.trim() : ''
    const location = typeof source?.location === 'string' ? source.location.trim() : ''
    const type = typeof source?.type === 'string' && SOURCE_TYPES.has(source.type)
      ? source.type
      : ''
    if (!id || ids.has(id) || !name || !location || !type) return []
    ids.add(id)
    return [{
      id,
      name,
      type,
      location,
      description: typeof source.description === 'string' ? source.description.trim() : '',
      enabled: source.enabled !== false,
    }]
  })
}

function isSameOrInside(candidate, parent) {
  const pathFromParent = relative(parent, candidate)
  return pathFromParent === '' || (!pathFromParent.startsWith('..') && !isAbsolute(pathFromParent))
}

export function validateKnowledgeSourceLocations(projectPath, sources) {
  const workspacePath = projectWorkspacePath(projectPath)
  for (const source of sources) {
    let url = null
    const hasUrlScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(source.location)
    if (source.type === 'url' || hasUrlScheme) {
      try {
        url = new URL(source.location)
      } catch {
        if (source.type === 'url') {
          throw new Error(`Die Wissensquelle "${source.name}" enthält keine gültige URL.`)
        }
      }
    }
    if (url) {
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error(`Die Wissensquelle "${source.name}" muss eine HTTP- oder HTTPS-URL verwenden.`)
      }
      continue
    }

    if (!isAbsolute(source.location)) {
      throw new Error(`Die Wissensquelle "${source.name}" benötigt einen absoluten lokalen Pfad.`)
    }
    const sourcePath = resolve(source.location)
    if (isSameOrInside(sourcePath, workspacePath) || isSameOrInside(workspacePath, sourcePath)) {
      throw new Error(`Die Wissensquelle "${source.name}" überschneidet sich mit dem beschreibbaren Projekt-Workspace und kann nicht schreibgeschützt eingebunden werden.`)
    }
  }
}

export async function readKnowledgeSources(projectPath) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) return []
  try {
    const payload = JSON.parse(await readFile(knowledgeSourcesFile(projectPath), 'utf8'))
    return normalizeKnowledgeSources(payload?.sources)
  } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
}

export async function writeKnowledgeSources(projectPath, sources) {
  if (typeof projectPath !== 'string' || !projectPath.trim()) {
    throw new Error('Projektpfad ist erforderlich.')
  }
  const normalized = normalizeKnowledgeSources(sources)
  if (normalized.length !== sources.length) {
    throw new Error('Mindestens eine Wissensquelle ist ungültig oder doppelt vorhanden.')
  }
  validateKnowledgeSourceLocations(projectPath, normalized)

  const filePath = knowledgeSourcesFile(projectPath)
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await mkdir(dirname(filePath), { recursive: true })
  await writeFile(temporaryPath, `${JSON.stringify({ version: 1, sources: normalized }, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, filePath)
  return normalized
}
