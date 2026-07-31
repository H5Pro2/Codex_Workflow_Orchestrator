import type { WorkflowSignalKind } from './workflow-protocol.ts'

export type WorkflowSupervisorCause =
  | 'automation-off'
  | 'missing-route'
  | 'missing-status'
  | 'fixed-forwarding-invalid'
  | 'duplicate-delivery'
  | 'blocked-follow-up'
  | 'unknown'

export type WorkflowSupervisorInput = {
  agentName: string
  automationEnabled: boolean
  activeRouteCount: number
  deliveryCount: number
  statusKind: WorkflowSignalKind
  statusNames: readonly string[]
  fixedForwardingEnabled: boolean
  fixedForwardingIssue?: string
  duplicateDelivery?: boolean
  blockedFollowUp?: boolean
  continuationReason?: string
}

export type WorkflowSupervisorDiagnosis = {
  cause: WorkflowSupervisorCause
  summary: string
  nextStep: string
}

export function diagnoseWorkflowStall(
  input: WorkflowSupervisorInput,
): WorkflowSupervisorDiagnosis {
  if (!input.automationEnabled) {
    return {
      cause: 'automation-off',
      summary: 'Die Automatik ist ausgeschaltet.',
      nextStep: 'Automatik aktivieren; danach den offenen Kontrollpunkt erneut starten.',
    }
  }

  if (input.fixedForwardingIssue) {
    return {
      cause: 'fixed-forwarding-invalid',
      summary: `Die feste Weiterleitung ist technisch unvollständig: ${input.fixedForwardingIssue}`,
      nextStep: 'Im Dashboard genau eine ausgehende Verbindung vom Weiterleiten-Baustein zu einem Zielagenten herstellen.',
    }
  }

  if (input.blockedFollowUp) {
    return {
      cause: 'blocked-follow-up',
      summary: `${input.agentName} hat keinen ausführbaren Folgeauftrag geliefert.`,
      nextStep: 'Arbeitsobjekt, konkrete Aufgabe, Erfolgskriterium und Verifikation im Chat klären; danach gezielt weiterleiten.',
    }
  }

  if (input.duplicateDelivery) {
    return {
      cause: 'duplicate-delivery',
      summary: 'Die Übergabe wurde bereits verarbeitet und deshalb nicht doppelt gesendet.',
      nextStep: 'Den offenen Kontrollpunkt prüfen; erst nach einer neuen Agentenantwort erneut weiterleiten.',
    }
  }

  if (input.statusKind !== 'valid' && input.statusKind !== 'none') {
    return {
      cause: 'missing-status',
      summary: input.statusNames.length > 0
        ? `Die Antwort enthält kein verwertbares, erlaubtes Statussignal: ${input.statusNames.join(', ')}.`
        : 'Die Antwort enthält kein verwertbares, erlaubtes Statussignal.',
      nextStep: 'Statuszuweisung und die letzte Statuszeile prüfen; bei einer Korrektur genau einen erlaubten Status als letzte Zeile ausgeben.',
    }
  }

  if (input.fixedForwardingEnabled && input.deliveryCount === 0) {
    return {
      cause: 'missing-route',
      summary: 'Der feste Status Weiterleiten ist vorhanden, aber es wurde kein Zielagent aufgelöst.',
      nextStep: 'Die Weiterleiten-Verbindung im Dashboard prüfen und genau einen Zielagenten anschließen.',
    }
  }

  if (input.activeRouteCount === 0) {
    return {
      cause: 'missing-route',
      summary: 'Der Agent hat keine ausgehende Workflow-Verbindung.',
      nextStep: 'Im Dashboard eine passende Verbindung zu einem vorhandenen Zielagenten herstellen.',
    }
  }

  if (input.deliveryCount === 0) {
    return {
      cause: 'missing-route',
      summary: 'Ein Status wurde erkannt, aber kein passender Zielpfad wurde aufgelöst.',
      nextStep: 'Prüfen, ob der erkannte Statusfilter aktiv ist und mit genau einem Zielagenten verbunden wurde.',
    }
  }

  return {
    cause: 'unknown',
    summary: 'Die Weitergabe wurde angehalten, obwohl ein technischer Anschluss vorhanden ist.',
    nextStep: input.continuationReason
      ? `Technische Ursache prüfen: ${input.continuationReason}`
      : 'Ablaufprotokoll und offenen Kontrollpunkt prüfen; keine automatische Wiederholung auslösen.',
  }
}

