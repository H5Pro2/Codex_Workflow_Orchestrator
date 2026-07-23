import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  WORKLOAD_ESCALATION_THRESHOLD,
  buildWorkloadEscalationResult,
  nextConsecutiveFailedRuns,
  shouldEscalateWorkload,
} from './workload-escalation.ts'

test('counts consecutive failed runs and escalates on the second failure', () => {
  assert.equal(nextConsecutiveFailedRuns(undefined), 1)
  assert.equal(nextConsecutiveFailedRuns(1), 2)
  assert.equal(shouldEscalateWorkload(WORKLOAD_ESCALATION_THRESHOLD - 1), false)
  assert.equal(shouldEscalateWorkload(WORKLOAD_ESCALATION_THRESHOLD), true)
})

test('builds a controlled overload escalation for the CEO', () => {
  const result = buildWorkloadEscalationResult({
    agentName: 'Implementierung',
    failureDetail: 'interrupted',
    failedRuns: 2,
    availableProgress: 'Grundgerüst erstellt.',
    errorStatusName: 'Fehler',
  })

  assert.match(result, /zusätzlichen Spezialagenten/)
  assert.match(result, /Rollen-Prompts, Statusbefehlen und Dashboard-Verbindungen/)
  assert.match(result, /Starte nichts automatisch/)
  assert.match(result, /Grundgerüst erstellt/)
  assert.match(result, /\[Workflow-Status: Fehler\]$/)
})
