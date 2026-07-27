import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  allowExplicitBrowserOrigins,
  explicitHttpOrigins,
  mergeAllowedOrigins,
} from './browser-origin-permissions.mjs'

test('extracts only explicit HTTP origins from a task', () => {
  assert.deepEqual(explicitHttpOrigins(
    'Öffne https://upload.wikimedia.org/path/video.webm und http://127.0.0.1:5173/test.',
  ), [
    'https://upload.wikimedia.org',
    'http://127.0.0.1:5173',
  ])
})

test('moves explicitly requested origins from denied to allowed', () => {
  const source = `[origins]\nallowed = ["https://example.com"]\ndenied = [\n    "https://commons.wikimedia.org",\n    "https://upload.wikimedia.org",\n]\n`
  const merged = mergeAllowedOrigins(source, ['https://upload.wikimedia.org'])

  assert.match(merged, /allowed = \[\n/u)
  assert.match(merged, /https:\/\/upload\.wikimedia\.org/u)
  assert.match(merged, /denied = \["https:\/\/commons\.wikimedia\.org"\]/u)
  assert.doesNotMatch(merged, /denied[\s\S]*https:\/\/upload\.wikimedia\.org/u)
})

test('stores browser permission for the exact agent task', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orchestrator-browser-'))
  try {
    const threadId = 'agent-thread-123'
    const origins = await allowExplicitBrowserOrigins(
      root,
      threadId,
      'Prüfe https://upload.wikimedia.org/video.webm',
    )
    const stored = await readFile(join(root, 'browser', 'sessions', `${threadId}.toml`), 'utf8')

    assert.deepEqual(origins, ['https://upload.wikimedia.org'])
    assert.match(stored, /allowed = \["https:\/\/upload\.wikimedia\.org"\]/u)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
