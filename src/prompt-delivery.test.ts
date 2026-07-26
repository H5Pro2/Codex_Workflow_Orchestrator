import assert from 'node:assert/strict'
import test from 'node:test'
import { verifiedPromptInstruction } from './prompt-delivery.ts'

test('embeds the verified prompt and keeps the file as an audit copy', () => {
  const result = verifiedPromptInstruction({
    path: '.codex-orchestrator/prompts/agent-1/Anweisung.md',
    sha256: 'abc123',
    content: 'Prüfe zuerst den Projektstand.',
  })
  assert.match(result, /SHA-256: `abc123`/)
  assert.match(result, /<orchestrator_role_instruction>\nPrüfe zuerst den Projektstand\./)
  assert.match(result, /arbeite mit dem eingebetteten Inhalt weiter/)
})
