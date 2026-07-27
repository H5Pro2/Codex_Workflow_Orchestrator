import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const HTTP_URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gu

export function explicitHttpOrigins(text) {
  const origins = new Set()

  for (const match of String(text ?? '').matchAll(HTTP_URL_PATTERN)) {
    const candidate = match[0].replace(/[),.;!?]+$/u, '')
    try {
      origins.add(new URL(candidate).origin)
    } catch {
      // Ignore malformed URL-like text.
    }
  }

  return [...origins]
}

function readStringArray(source, key) {
  const match = source.match(new RegExp(`(?:^|\\n)${key}\\s*=\\s*(\\[[\\s\\S]*?\\])`, 'u'))
  if (!match) return []
  const values = []
  for (const stringMatch of match[1].matchAll(/"(?:\\.|[^"\\])*"/gu)) {
    try {
      values.push(JSON.parse(stringMatch[0]))
    } catch {
      // Ignore malformed entries while preserving valid generated origins.
    }
  }
  return values
}

function formatStringArray(key, values) {
  if (values.length === 0) return ''
  if (values.length === 1) return `${key} = [${JSON.stringify(values[0])}]\n`
  return `${key} = [\n${values.map((value) => `    ${JSON.stringify(value)},`).join('\n')}\n]\n`
}

export function mergeAllowedOrigins(source, requestedOrigins) {
  const requested = new Set(requestedOrigins)
  if (requested.size === 0) return source

  const allowed = [...new Set([...readStringArray(source, 'allowed'), ...requested])].sort()
  const denied = readStringArray(source, 'denied').filter((origin) => !requested.has(origin)).sort()
  return `[origins]\n${formatStringArray('allowed', allowed)}${formatStringArray('denied', denied)}`
}

export async function allowExplicitBrowserOrigins(codexHome, threadId, text) {
  const origins = explicitHttpOrigins(text)
  if (origins.length === 0 || !/^[a-zA-Z0-9-]+$/u.test(threadId)) return origins

  const filePath = join(codexHome, 'browser', 'sessions', `${threadId}.toml`)
  let current = ''
  try {
    current = await readFile(filePath, 'utf8')
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error
  }

  const next = mergeAllowedOrigins(current, origins)
  if (next === current) return origins

  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.tmp`
  await writeFile(temporaryPath, next, 'utf8')
  await rename(temporaryPath, filePath)
  return origins
}
