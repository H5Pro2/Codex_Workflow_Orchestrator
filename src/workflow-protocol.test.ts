import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  UNCONDITIONAL_FORWARD_STATUS_ID,
  parseWorkflowSignal,
  workflowSignalIssue,
  workflowStatusInstruction,
} from './workflow-protocol.ts'

const statuses = [
  { id: 'forward', name: 'Weiterleitung', description: 'Weitergeben' },
  { id: 'error', name: 'Fehler', description: 'Technischer Fehler' },
]

test('accepts exactly one known terminal workflow status', () => {
  assert.deepEqual(parseWorkflowSignal('Erledigt.\n[Workflow-Status: Weiterleitung]', statuses), {
    kind: 'valid',
    statusIds: ['forward'],
    names: ['Weiterleitung'],
    unknownNames: [],
    source: 'marker',
  })
})

test('classifies incomplete CEO answers without a status', () => {
  const signal = parseWorkflowSignal('Ich habe die Übergabe vorbereitet.', statuses)
  assert.equal(signal.kind, 'missing')
  assert.match(workflowSignalIssue(signal), /keinen Workflow-Status/)
})

test('rejects unknown, multiple, and misplaced status markers', () => {
  assert.equal(parseWorkflowSignal('[Workflow-Status: Erfinden]', statuses).kind, 'unknown')
  assert.equal(parseWorkflowSignal(
    '[Workflow-Status: Fehler]\n[Workflow-Status: Weiterleitung]',
    statuses,
  ).kind, 'ambiguous')
  assert.equal(parseWorkflowSignal(
    '[Workflow-Status: Weiterleitung]\nNoch ein Satz.',
    statuses,
  ).kind, 'misplaced')
  assert.equal(parseWorkflowSignal(
    'Erledigt. [Workflow-Status: Weiterleitung]',
    statuses,
  ).kind, 'misplaced')
})

test('treats explicit no-status as a valid non-routing signal', () => {
  assert.equal(parseWorkflowSignal('[Workflow-Status: Kein Status]', statuses).kind, 'none')
})

test('keeps one legacy JSON status for backward compatibility', () => {
  assert.deepEqual(
    parseWorkflowSignal('{"workflow_status":"Fehler"}', statuses).statusIds,
    ['error'],
  )
})

test('status instructions define technical topology as authoritative', () => {
  const instruction = workflowStatusInstruction(statuses)
  assert.match(instruction, /technische Topologie entscheidet/)
  assert.match(instruction, /Mehrere Statusangaben/)
  assert.match(instruction, /Interner Workflow-Fehler/)
  assert.match(instruction, /kein Projektfehler/)
})

test('fixed forwarding tells the agent to answer without a status marker', () => {
  const instruction = workflowStatusInstruction([{
    id: UNCONDITIONAL_FORWARD_STATUS_ID,
    name: 'Weiterleiten',
  }])
  assert.match(instruction, /jede abgeschlossene Antwort automatisch/u)
  assert.match(instruction, /Setze keinen Workflow-Status/u)
  assert.match(instruction, /autorisierter Workflow-Auftrag/u)
  assert.match(instruction, /keine zweite Freigabe durch den Benutzer/u)
  assert.doesNotMatch(instruction, /\[Workflow-Status: STATUSNAME\]/u)
})
