export const INTERNAL_WORKFLOW_ERROR_STATUS_ID = 'system:internal-workflow-error'
export const INTERNAL_WORKFLOW_ERROR_STATUS_NAME = 'Interner Workflow-Fehler'
export const INTERNAL_WORKFLOW_ERROR_STATUS_DESCRIPTION =
  'Verwende diesen Systemstatus ausschließlich, wenn keine zugewiesene fachliche Statusmeldung eindeutig zum Ergebnis passt. Das ist ein interner Konfigurationsfehler und kein Projektfehler.'

export type InternalWorkflowAgentLike = {
  id: string
  projectPath: string
  assignment: 'agent' | 'management'
}

function samePath(left: string, right: string) {
  return left.trim().replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE') ===
    right.trim().replaceAll('\\', '/').replace(/\/$/, '').toLocaleLowerCase('de-DE')
}

export function internalWorkflowErrorStatus(projectPath: string) {
  return {
    id: INTERNAL_WORKFLOW_ERROR_STATUS_ID,
    projectPath,
    name: INTERNAL_WORKFLOW_ERROR_STATUS_NAME,
    description: INTERNAL_WORKFLOW_ERROR_STATUS_DESCRIPTION,
  }
}

export function isInternalWorkflowErrorStatus(statusIds: readonly string[]) {
  return statusIds.length === 1 && statusIds[0] === INTERNAL_WORKFLOW_ERROR_STATUS_ID
}

export function shouldEscalateInternalWorkflowError({
  assignment,
  signalKind,
  runPurpose,
  statusIds,
}: {
  assignment: 'agent' | 'management'
  signalKind: string
  runPurpose: string
  statusIds: readonly string[]
}) {
  if (isInternalWorkflowErrorStatus(statusIds)) return true
  if (assignment !== 'agent') return false
  if (signalKind === 'none') return true
  return runPurpose === 'status-repair' && signalKind !== 'valid'
}

export function internalWorkflowErrorManagerId(
  source: InternalWorkflowAgentLike,
  agents: readonly InternalWorkflowAgentLike[],
) {
  if (source.assignment === 'management') return ''
  return agents.find(
    (agent) =>
      agent.assignment === 'management' &&
      samePath(agent.projectPath, source.projectPath),
  )?.id ?? ''
}

export function internalWorkflowErrorHandoffInstruction(issue = '') {
  return [
    'Dies ist ein interner Workflow-Konfigurationsfehler und kein fachlicher Projektfehler.',
    issue ? `Erkannte Protokoll- oder Statuslücke: ${issue}` : '',
    'Prüfe explizit, warum keine zugewiesene Statusmeldung eindeutig zum Ergebnis des meldenden Agenten passt.',
    'Entscheide, ob eine Statusbeschreibung präzisiert, ein Status ergänzt, eine Zuweisung korrigiert oder eine Dashboard-Verbindung repariert werden muss.',
    'Der meldende Fachagent darf diese Konfiguration nicht selbst verändern.',
    'Führe keine Facharbeit des Projekts aus und erkläre den Projektabschnitt nicht für gescheitert.',
  ].filter(Boolean).join('\n')
}
