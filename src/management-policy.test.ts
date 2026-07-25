import assert from 'node:assert/strict'
import { test } from 'node:test'
import { managementRulebook } from './management-policy.ts'

test('CEO rulebook prohibits programming and specialist work', () => {
  const rulebook = managementRulebook('configuration')
  assert.match(rulebook, /Du programmierst nicht/)
  assert.match(rulebook, /keine Fachaufgabe eines Spezialagenten/)
  assert.match(rulebook, /Vorrang vor Rollen-Prompts/)
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
  assert.match(rulebook, /bestehende Team/)
})
