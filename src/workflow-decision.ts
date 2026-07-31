import { workflowSignalIssue, type WorkflowSignal } from './workflow-protocol.ts'

export type WorkflowContinuation =
  | { action: 'continue'; reason: '' }
  | { action: 'stop'; reason: string }

export function decideWorkflowContinuation({
  signal,
  deliveryCount,
  activeRouteCount,
}: {
  signal: WorkflowSignal
  deliveryCount: number
  activeRouteCount: number
}): WorkflowContinuation {
  if (deliveryCount > 0) return { action: 'continue', reason: '' }
  if (activeRouteCount === 0) {
    return { action: 'stop', reason: 'Der Agent besitzt keine ausgehende Workflow-Verbindung.' }
  }
  return {
    action: 'stop',
    reason: workflowSignalIssue(signal) || 'Für den gemeldeten Workflow-Status existiert kein Fortsetzungsweg.',
  }
}
