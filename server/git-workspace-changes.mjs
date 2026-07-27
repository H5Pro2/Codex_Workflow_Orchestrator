import { execFile } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function changeKind(status) {
  if (status === '??' || status.includes('A')) return 'added'
  if (status.includes('D')) return 'deleted'
  if (status.includes('R')) return 'renamed'
  return 'modified'
}

async function fingerprint(root, path) {
  const absolutePath = resolve(root, path)
  const rootPrefix = `${resolve(root)}${sep}`.toLocaleLowerCase()
  if (!absolutePath.toLocaleLowerCase().startsWith(rootPrefix)) return 'outside-workspace'
  try {
    const details = await stat(absolutePath)
    return `${details.size}:${details.mtimeMs}`
  } catch {
    return 'missing'
  }
}

export async function captureGitWorkspace(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return null
  try {
    const { stdout: rootOutput } = await execFileAsync(
      'git',
      ['-C', cwd, 'rev-parse', '--show-toplevel'],
      { encoding: 'utf8', windowsHide: true },
    )
    const root = rootOutput.trim()
    if (!root) return null
    const { stdout } = await execFileAsync(
      'git',
      ['-C', root, 'status', '--porcelain=v1', '--untracked-files=all'],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    )
    const entries = {}
    for (const line of stdout.split(/\r?\n/u)) {
      if (!line) continue
      const status = line.slice(0, 2)
      const rawPath = line.slice(3)
      const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').at(-1) : rawPath
      if (!path) continue
      entries[path] = { status, fingerprint: await fingerprint(root, path) }
    }
    return { root, entries }
  } catch {
    return null
  }
}

export function compareGitWorkspaces(before, after) {
  if (!before || !after || before.root !== after.root) return []
  const paths = new Set([...Object.keys(before.entries), ...Object.keys(after.entries)])
  return [...paths]
    .filter((path) => {
      const previous = before.entries[path]
      const current = after.entries[path]
      return !previous || !current ||
        previous.status !== current.status || previous.fingerprint !== current.fingerprint
    })
    .map((path) => ({
      path: path.replaceAll('\\', '/'),
      kind: changeKind(after.entries[path]?.status ?? before.entries[path]?.status ?? ' M'),
    }))
    .sort((left, right) => left.path.localeCompare(right.path, 'de'))
}
