import assert from 'node:assert/strict'
import { test } from 'node:test'
import { manualInstructionSupersedesCheckpoints } from './manual-checkpoint-policy.ts'

test('a status reset does not discard a pending specialist handoff', () => {
  assert.equal(manualInstructionSupersedesCheckpoints('Status bitte zurücksetzen'), false)
  assert.equal(manualInstructionSupersedesCheckpoints('Lösche die Statusmeldung'), false)
})

test('a new management task may supersede an older checkpoint', () => {
  assert.equal(manualInstructionSupersedesCheckpoints('Baue das vorhandene Spiel um'), true)
  assert.equal(manualInstructionSupersedesCheckpoints('Erstelle einen neuen Forschungsauftrag'), true)
})
