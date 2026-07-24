import { readFile, rename, writeFile } from 'node:fs/promises'

export const MAINTENANCE_THREAD_NAME = 'Systemwartung - Kommunikations-Handwerker'

export const EMPTY_MAINTENANCE_STATE = Object.freeze({
  threadId: '',
  turnId: '',
  status: 'idle',
  // Active states from older versions had no origin and were triggered by automation.
  origin: 'automatic',
  incident: '',
  report: '',
  error: '',
  updatedAt: '',
})

export function stoppedMaintenanceState(state) {
  return {
    ...state,
    turnId: '',
    status: 'idle',
    origin: 'manual',
    incident: '',
    report: '',
    error: '',
  }
}

export function maintenanceDiagnosticPrompt(incident, context = '') {
  return [
    'Du bist der interne Kommunikations-Handwerker des Codex Workflow Orchestrators.',
    'Dein Zuständigkeitsbereich ist strikt begrenzt auf die technische Verarbeitung und Kommunikation der Agenten:',
    '- Codex-Connector und App-Server-Protokoll',
    '- Turn-Erstellung, Persistenz, Ergebnisabfrage und Unterbrechung',
    '- Agentenstatus, Warteschlangen, Übergaben, Statusrouting und Automatik-Lease',
    '- Hänger, doppelte Übergaben, fehlende Turn-IDs und inkonsistente Workflow-Zustände',
    '',
    'Nicht erlaubt sind fachliche Arbeiten in Benutzerprojekten oder eigenmächtige Änderungen.',
    'Analysiere zunächst ausschließlich lesend. Ändere keine Datei, starte keinen Prozess neu und führe keinen Git-Befehl aus.',
    'Nenne Ursache, betroffene Komponente, belastbare Indizien und einen möglichst kleinen Reparaturvorschlag.',
    'Kennzeichne ausdrücklich, ob eine Codeänderung und/oder ein Connector-Neustart erforderlich ist.',
    '',
    `Vorfall: ${incident.trim() || 'Manuell angeforderte Systemprüfung'}`,
    context.trim() ? `Zusätzlicher Kontext:\n${context.trim()}` : '',
  ].filter(Boolean).join('\n')
}

export function maintenanceRepairPrompt(report) {
  return [
    'Der Benutzer hat die Umsetzung des folgenden Wartungsberichts ausdrücklich bestätigt.',
    'Arbeite ausschließlich im Codex Workflow Orchestrator und ausschließlich an Verarbeitung und Agentenkommunikation.',
    'Ändere keine fachlichen Benutzerprojekte. Führe keine Git-Operation und keinen Prozessneustart aus.',
    'Setze die kleinste belastbare Korrektur um und prüfe sie mit den vorhandenen Tests, Lint und Build.',
    'Dokumentiere danach geänderte Dateien, Prüfungen und ob weiterhin ein Neustart erforderlich ist.',
    '',
    'Bestätigter Wartungsbericht:',
    report.trim(),
  ].join('\n')
}

export function createMaintenanceStateStore(filePath) {
  let writeQueue = Promise.resolve()

  const read = async () => {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'))
      return { ...EMPTY_MAINTENANCE_STATE, ...parsed }
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return { ...EMPTY_MAINTENANCE_STATE }
      }
      throw error
    }
  }

  const write = async (state) => {
    const next = { ...EMPTY_MAINTENANCE_STATE, ...state, updatedAt: new Date().toISOString() }
    writeQueue = writeQueue.then(async () => {
      const temporaryPath = `${filePath}.tmp`
      await writeFile(temporaryPath, JSON.stringify(next, null, 2), 'utf8')
      await rename(temporaryPath, filePath)
    })
    await writeQueue
    return next
  }

  return { read, write }
}
