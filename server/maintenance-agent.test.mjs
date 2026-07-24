import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  createMaintenanceStateStore,
  findMaintenanceReportManager,
  maintenanceDiagnosticPrompt,
  maintenanceReportPrompt,
  stoppedMaintenanceState,
} from './maintenance-agent.mjs'

test('diagnosis prompt keeps the maintenance agent inside its communication scope', () => {
  const prompt = maintenanceDiagnosticPrompt('Turn bleibt aktiv', 'Agent CEO')
  assert.match(prompt, /Diagnose-Worker/)
  assert.match(prompt, /Ändere keine Datei/)
  assert.match(prompt, /Turn bleibt aktiv/)
  assert.match(prompt, /Agent CEO/)
})

test('stopping automatic maintenance clears the active operation', () => {
  const state = stoppedMaintenanceState({
    threadId: 'thread-1',
    turnId: 'turn-1',
    status: 'diagnosing',
    origin: 'automatic',
    incident: 'Stalled turn',
    report: '',
    error: '',
  })
  assert.equal(state.status, 'idle')
  assert.equal(state.turnId, '')
  assert.equal(state.threadId, 'thread-1')
})

test('report prompt assigns decisions to the CEO and keeps topology controlled', () => {
  const prompt = maintenanceReportPrompt({
    incident: 'Connector polling prüfen',
    report: 'Turn-Zuordnung ist unklar.',
    sourceAgentId: 'implementation',
  })
  assert.match(prompt, /Worker hat nichts geändert, repariert oder neu gestartet/)
  assert.match(prompt, /CEO/)
  assert.match(prompt, /Nur der Orchestrator/)
})

test('selects exactly one idle project manager for a diagnosis report', () => {
  const state = {
    projectPath: 'C:\\work\\project',
    sourceAgentId: 'implementation',
    reportForwardedAt: '',
  }
  const manager = {
    id: 'ceo',
    assignment: 'management',
    projectPath: 'c:/work/project/',
    threadId: 'thread-ceo',
    status: 'wartet',
    pendingTurnId: '',
  }
  const source = { id: 'implementation', projectPath: 'C:/work/project' }
  assert.equal(findMaintenanceReportManager(state, [source, manager])?.id, 'ceo')
  assert.equal(findMaintenanceReportManager(state, [source, manager, { ...manager, id: 'lead' }]), null)
  assert.equal(findMaintenanceReportManager(state, [source, { ...manager, pendingTurnId: 'turn-1' }]), null)
  assert.equal(findMaintenanceReportManager(state, [manager]), null)
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
