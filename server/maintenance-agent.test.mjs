import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createMaintenanceStateStore,
  maintenanceDiagnosticPrompt,
  maintenanceRepairPrompt,
} from './maintenance-agent.mjs'

test('diagnosis prompt keeps the maintenance agent inside its communication scope', () => {
  const prompt = maintenanceDiagnosticPrompt('Turn bleibt aktiv', 'Agent CEO')
  assert.match(prompt, /Kommunikations-Handwerker/)
  assert.match(prompt, /Ändere keine Datei/)
  assert.match(prompt, /Turn bleibt aktiv/)
  assert.match(prompt, /Agent CEO/)
})

test('repair prompt requires prior confirmation and forbids restart and git', () => {
  const prompt = maintenanceRepairPrompt('Connector polling korrigieren')
  assert.match(prompt, /ausdrücklich bestätigt/)
  assert.match(prompt, /keinen Prozessneustart/)
  assert.match(prompt, /keine Git-Operation/)
})

test('maintenance state is stored atomically with defaults', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'orchestrator-maintenance-'))
  const filePath = join(directory, 'state.json')
  const store = createMaintenanceStateStore(filePath)
  try {
    assert.equal((await store.read()).status, 'idle')
    const written = await store.write({ status: 'diagnosing', incident: 'Test' })
    assert.equal(written.status, 'diagnosing')
    assert.ok(written.updatedAt)
    assert.equal((await store.read()).incident, 'Test')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
