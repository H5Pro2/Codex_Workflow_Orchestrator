import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProgramSettingsStore, normalizeProgramSettings } from './program-settings.mjs'

test('normalizes global profile and appearance settings', () => {
  const settings = normalizeProgramSettings({
    displayName: 'Testkonto',
    theme: 'light',
    accentColor: '#AABBCC',
    buttonColor: '#123456',
    buttonTextColor: '#FEDCBA',
    contrast: 140,
    showWorkflowStatusLines: true,
  })

  assert.equal(settings.displayName, 'Testkonto')
  assert.equal(settings.theme, 'light')
  assert.equal(settings.accentColor, '#aabbcc')
  assert.equal(settings.buttonColor, '#123456')
  assert.equal(settings.buttonTextColor, '#fedcba')
  assert.equal(settings.contrast, 100)
  assert.equal(settings.showWorkflowStatusLines, true)
})

test('stores program settings atomically outside browser storage', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orchestrator-settings-'))
  try {
    const store = createProgramSettingsStore(join(root, 'program-settings.json'))
    assert.deepEqual(await store.read(), { settings: null, updatedAt: '' })

    const written = await store.write({ displayName: 'Global', buttonColor: '#334455' })
    const read = await store.read()
    assert.equal(read.settings.displayName, 'Global')
    assert.equal(read.settings.buttonColor, '#334455')
    assert.equal(read.updatedAt, written.updatedAt)
  } finally {
    await rm(root, { force: true, recursive: true })
  }
})
