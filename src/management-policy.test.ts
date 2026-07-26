import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_CEO_INSTRUCTIONS,
  managementRulebook,
  visibleOrchestratorMessage,
  withInternalInstructions,
} from './management-policy.ts'

test('CEO rulebook prohibits programming and specialist work', () => {
  const rulebook = managementRulebook('configuration')
  assert.match(rulebook, /Du programmierst nicht/)
  assert.match(rulebook, /keine Fachaufgabe eines Spezialagenten/)
  assert.match(rulebook, /Vorrang vor Rollen-Prompts/)
  assert.match(rulebook, /technische Workflow-Topologie entscheidet/)
  assert.match(rulebook, /keine technische Verbindung erzeugen/)
  assert.match(rulebook, /Projektziel wird ausschließlich vom Benutzer/)
  assert.match(rulebook, /echten Umlauten und ß/)
  assert.match(rulebook, /Interner Workflow-Fehler/)
  assert.match(rulebook, /nicht als fachlichen Projektfehler/)
})

test('manual CEO work prepares delegation and waits for Auto Start', () => {
  const rulebook = managementRulebook('manual')
  assert.match(rulebook, /Delegationspaket/)
  assert.match(rulebook, /Auto Start drücken/)
  assert.match(rulebook, /Workflow-Status: Kein Status/)
})

test('automated CEO work delegates through an existing status route', () => {
  const rulebook = managementRulebook('automation')
  assert.match(rulebook, /vorhandenen, passenden Workflow-Status/)
  assert.match(rulebook, /prüfbare Akzeptanzkriterien/)
  DEFAULT_CEO_INSTRUCTIONS.forEach((instruction) => assert.ok(rulebook.includes(instruction)))
})

test('configured CEO instructions replace the editable default list', () => {
  const rulebook = managementRulebook('automation', ['Berichte besonders knapp.'])
  assert.match(rulebook, /Berichte besonders knapp/)
  DEFAULT_CEO_INSTRUCTIONS.forEach((instruction) => assert.ok(!rulebook.includes(instruction)))
})

test('the editable CEO instruction list may be empty', () => {
  const rulebook = managementRulebook('automation', [])
  DEFAULT_CEO_INSTRUCTIONS.forEach((instruction) => assert.ok(!rulebook.includes(instruction)))
  assert.match(rulebook, /Du programmierst nicht/)
})

test('internal CEO instructions are hidden from the visible chat message', () => {
  const message = withInternalInstructions('Start', managementRulebook('automation'))
  assert.equal(visibleOrchestratorMessage(message), 'Start')
  assert.match(message, /CEO-Regelbuch/)
})
