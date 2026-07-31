import assert from 'node:assert/strict'
import test from 'node:test'
import {
  fixedForwardingAuthorizationRepairInstruction,
  fixedForwardingNextTaskRepairInstruction,
  isFixedForwardingIncompleteTask,
  isFixedForwardingAuthorizationStall,
  isFixedForwardingNoNextTask,
} from './fixed-forwarding-stall.ts'

test('detects a fixed-forwarding response that incorrectly asks for another approval', () => {
  assert.equal(isFixedForwardingAuthorizationStall(
    'Lauf 160 bleibt eine Empfehlung. Eine ausdrueckliche Ausfuehrungsfreigabe liegt nicht vor.',
  ), true)
  assert.equal(isFixedForwardingAuthorizationStall(
    'Der Lauf darf erst nach einer eigenstaendigen Beauftragung begonnen werden.',
  ), true)
  assert.equal(isFixedForwardingAuthorizationStall(
    'Lauf 160 bleibt eine Empfehlung. Eine ausdrückliche Ausführungsfreigabe liegt nicht vor.',
  ), true)
})

test('does not classify an executed or explicitly approved task as an authorization stall', () => {
  assert.equal(isFixedForwardingAuthorizationStall(
    'Lauf 160 wurde ausgefuehrt. Die Inventarisierung ist abgeschlossen.',
  ), false)
  assert.equal(isFixedForwardingAuthorizationStall(
    'Der naechste Lauf ist freigegeben und wird an den Forschungsagenten uebergeben.',
  ), false)
})

test('repair instruction defines the existing handoff as authoritative', () => {
  const instruction = fixedForwardingAuthorizationRepairInstruction()
  assert.match(instruction, /bereits als Agent-zu-Agent-Auftrag autorisiert/)
  assert.match(instruction, /Fordere keine zweite Benutzerfreigabe an/)
})

test('detects a diagnostic response without an executable work order', () => {
  assert.equal(isFixedForwardingIncompleteTask(
    'Es fehlt ein konkretes Arbeitsobjekt. Deshalb konnte keine technische Arbeit beginnen.',
  ), true)
  assert.equal(isFixedForwardingIncompleteTask(
    'Arbeitsobjekt: src/field/feedback.py\nAufgabe: Prüfe die Funktion.\nErfolgskriterium: Test ist grün.',
  ), false)
  assert.equal(isFixedForwardingIncompleteTask(
    'Naechster Auftrag: Keiner. Diese Kette ist beendet. Weitere Arbeit ist erst durch einen neuen Auftrag moeglich.',
  ), true)
})

test('distinguishes a completed part-task from a completed project', () => {
  const result = 'Nächster Auftrag: Keiner. Diese Kette ist beendet. Weitere Arbeit ist erst durch einen neuen Auftrag möglich.'
  assert.equal(isFixedForwardingNoNextTask(result), true)
  assert.match(fixedForwardingNextTaskRepairInstruction(), /übergeordnete Projekt ist dadurch nicht abgeschlossen/)
})
