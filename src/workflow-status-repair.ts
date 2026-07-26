import type { WorkflowSignalKind, WorkflowStatusLike } from './workflow-protocol.ts'

export function shouldRequestWorkflowStatusRepair({
  signalKind,
  activeRouteCount,
  runPurpose,
  hasThread,
}: {
  signalKind: WorkflowSignalKind
  activeRouteCount: number
  runPurpose: string
  hasThread: boolean
}) {
  return (
    signalKind !== 'valid' &&
    signalKind !== 'none' &&
    activeRouteCount > 0 &&
    runPurpose !== 'status-repair' &&
    hasThread
  )
}

export function workflowStatusRepairInstruction(
  issue: string,
  statuses: readonly WorkflowStatusLike[],
) {
  return [
    'Automatische Workflow-Protokollkorrektur:',
    `Die unmittelbar vorherige Antwort konnte nicht weitergeleitet werden: ${issue}`,
    '',
    'Korrigiere ausschließlich das Abschlussformat dieser vorherigen Antwort.',
    'Führe keine Facharbeit erneut aus, ändere keine fachliche Entscheidung und erfinde keinen neuen Auftrag.',
    'Wähle den einen Status, der zu dem in deiner vorherigen Antwort bereits genannten nächsten Schritt passt.',
    'Wenn keine fachliche Statusmeldung eindeutig passt, verwende den reservierten Status "Interner Workflow-Fehler" und benenne die geprüften Statusmeldungen sowie die erkannte Konfigurationslücke.',
    'Antworte mit einer knappen Bestätigung und setze als allerletzte Zeile genau einen Status.',
    'Verwende exakt einen Namen aus dieser Liste:',
    ...(statuses.length > 0
      ? statuses.map((status) => `- ${status.name}: ${status.description || 'Keine Beschreibung'}`)
      : ['- Kein Status verfügbar']),
    '',
    'Verbindliches Format der letzten Zeile: [Workflow-Status: STATUSNAME]',
    'Schreibe nach dieser Statuszeile keinen weiteren Text.',
  ].join('\n')
}
