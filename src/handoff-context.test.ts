import assert from 'node:assert/strict'
import test from 'node:test'
import { currentHandoffContextInstruction } from './handoff-context.ts'

test('handoff context keeps the current result authoritative', () => {
  const instruction = currentHandoffContextInstruction()

  assert.match(instruction, /aktuelle und maßgebliche Eingang/)
  assert.match(instruction, /Frühere Nachrichten/)
  assert.match(instruction, /technischen Laufabbruch/)
})
