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
  projectPath: '',
  sourceAgentId: '',
  reportDeliveryStatus: 'not-applicable',
  reportForwardedAt: '',
  reportForwardedToAgentId: '',
  reportForwardedTurnId: '',
  reportDeliveryError: '',
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
    projectPath: '',
    sourceAgentId: '',
    reportDeliveryStatus: 'not-applicable',
    reportForwardedAt: '',
    reportForwardedToAgentId: '',
    reportForwardedTurnId: '',
    reportDeliveryError: '',
    error: '',
  }
}

export function maintenanceDiagnosticPrompt(incident, context = '') {
  return [
    'Du bist der interne Diagnose-Worker für die Kommunikation des Codex Workflow Orchestrators.',
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

export function findMaintenanceReportManager(state, agents) {
  if (!state.projectPath || !state.sourceAgentId || state.reportForwardedAt) return null

  const normalizePath = (value) => value.trim().replaceAll('\\', '/').replace(/\/$/, '').toLowerCase()
  const projectPath = normalizePath(state.projectPath)
  const sourceExists = agents.some((agent) => (
    agent.id === state.sourceAgentId && normalizePath(agent.projectPath ?? '') === projectPath
  ))
  if (!sourceExists) return null

  const managers = agents.filter((agent) => (
    agent.id !== state.sourceAgentId &&
    agent.assignment === 'management' &&
    normalizePath(agent.projectPath ?? '') === projectPath &&
    typeof agent.threadId === 'string' &&
    agent.threadId.trim()
  ))
  if (managers.length !== 1) return null

  const manager = managers[0]
  return manager.status === 'laeuft' || manager.pendingTurnId ? null : manager
}

export function maintenanceReportPrompt({ incident, report, sourceAgentId }) {
  return [
    'Der diagnose-only Kommunikationsworker hat den folgenden technischen Bericht erstellt.',
    'Der Worker hat nichts geändert, repariert oder neu gestartet.',
    'Du bist als CEO für die Bewertung und die nächsten Schritte verantwortlich.',
    'Prüfe den Bericht, entscheide über eine begrenzte Wiederaufnahmeanweisung und gib sie an den betroffenen Agenten zurück.',
    'Sind dauerhafte Änderungen an Agenten, Statusfiltern oder Verbindungen erforderlich, liefere einen vollständigen Teamplan. Nur der Orchestrator darf ihn nach Benutzerfreigabe anwenden.',
    'Nimm keine unkontrollierte Änderung an der Workflow-Topologie vor.',
    '',
    `Betroffener Agent: ${sourceAgentId || 'unbekannt'}`,
    `Vorfall: ${incident.trim() || 'Technischer Kommunikationsfehler'}`,
    '',
    'Diagnosebericht:',
    report.trim() || 'Kein Diagnoseinhalt vorhanden.',
  ].join('\n')
}

export function createMaintenanceStateStore(filePath) {
  let writeQueue = Promise.resolve()

  const read = async () => {
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'))
      if (parsed.status === 'repairing') {
        return {
          ...EMPTY_MAINTENANCE_STATE,
          ...parsed,
          turnId: '',
          status: 'failed',
          error: 'Eine alte Worker-Reparatur wurde beendet. Der Worker dient jetzt ausschließlich der Diagnose.',
        }
      }
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
