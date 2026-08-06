import assert from 'node:assert/strict'
import test from 'node:test'
import { currentHandoffContextInstruction } from './handoff-context.ts'

test('handoff context requires reading the source result instead of copied payload', () => {
  const instruction = currentHandoffContextInstruction()

  assert.match(instruction, /kopiert keinen Ergebnistext/)
  assert.match(instruction, /Quell-Agenten/)
  assert.match(instruction, /Workflow-Verdrahtung/)
})
