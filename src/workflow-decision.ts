import { workflowSignalIssue, type WorkflowSignal } from './workflow-protocol.ts'

export type WorkflowContinuation =
  | { action: 'continue'; reason: '' }
  | { action: 'observe'; reason: '' }
  | { action: 'stop'; reason: string }

export function decideWorkflowContinuation({
  signal,
  deliveryCount,
  managementObservation,
  activeRouteCount,
}: {
  signal: WorkflowSignal
  deliveryCount: number
  managementObservation: boolean
  activeRouteCount: number
}): WorkflowContinuation {
  if (managementObservation) return { action: 'observe', reason: '' }
  if (deliveryCount > 0) return { action: 'continue', reason: '' }
  if (activeRouteCount === 0) {
    return { action: 'stop', reason: 'Der Agent besitzt keine ausgehende Workflow-Verbindung.' }
  }
  return {
    action: 'stop',
    reason: workflowSignalIssue(signal) || 'Für den gemeldeten Workflow-Status existiert kein Fortsetzungsweg.',
  }
}
