import assert from 'node:assert/strict'
import test from 'node:test'
import { fixedForwardingHandoffInstruction } from './fixed-forwarding-policy.ts'

test('fixed forwarding turns a concrete follow-up into an authorized assignment', () => {
  const instruction = fixedForwardingHandoffInstruction()

  assert.match(instruction, /autorisierter Workflow-Auftrag/)
  assert.match(instruction, /keine zweite Freigabe durch den Benutzer/)
  assert.match(instruction, /ausführbaren Auftrag frei/)
  assert.match(instruction, /physische Handlung/)
})
