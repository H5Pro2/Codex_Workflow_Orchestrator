export const WORKLOAD_ESCALATION_THRESHOLD = 2

type WorkloadEscalationInput = {
  agentName: string
  failureDetail: string
  failedRuns: number
  availableProgress: string
  errorStatusName: string
}

export function nextConsecutiveFailedRuns(current: number | undefined) {
  return Math.max(0, current ?? 0) + 1
}

export function shouldEscalateWorkload(failedRuns: number) {
  return failedRuns >= WORKLOAD_ESCALATION_THRESHOLD
}

export function buildWorkloadEscalationResult({
  agentName,
  failureDetail,
  failedRuns,
  availableProgress,
  errorStatusName,
}: WorkloadEscalationInput) {
  const progress = availableProgress.trim()
    ? availableProgress.trim()
    : 'Vom überlasteten Agenten liegt kein belastbares Teilergebnis vor.'

  return [
    'Die Aufgabe überfordert den aktuellen Einzelagenten oder ist für einen Lauf zu groß.',
    `Betroffener Agent: ${agentName}`,
    `Aufeinanderfolgende Fehlläufe: ${failedRuns}`,
    `Letzter Fehler: ${failureDetail}`,
    '',
    'Verfügbarer Arbeitsstand des betroffenen Agenten:',
    progress,
    '',
    'Auftrag an den Verwaltungsagenten / CEO:',
    `1. Stimme die weitere Aufteilung mit dem verfügbaren Arbeitsstand von ${agentName} ab und erhalte bereits nutzbare Ergebnisse.`,
    '2. Zerlege die verbleibende Aufgabe in klar begrenzte, voneinander prüfbare Arbeitspakete.',
    '3. Plane mindestens einen zusätzlichen Spezialagenten für den ausgelagerten Teil, sofern die Aufteilung dies erfordert.',
    '4. Liefere einen vollständigen kontrollierten Team-Vorschlag mit Agenten, Rollen-Prompts, Statusbefehlen und Dashboard-Verbindungen.',
    '5. Starte nichts automatisch. Der Benutzer prüft und übernimmt den Vorschlag bei Auto Stop.',
    '',
    `[Workflow-Status: ${errorStatusName}]`,
  ].join('\n')
}
