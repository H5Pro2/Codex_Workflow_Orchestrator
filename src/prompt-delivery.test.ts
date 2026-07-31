import assert from 'node:assert/strict'
import test from 'node:test'
import { absolutePromptReference, verifiedPromptInstruction } from './prompt-delivery.ts'

test('embeds the verified prompt and keeps the file as an audit copy', () => {
  const result = verifiedPromptInstruction({
    path: '.codex-orchestrator/prompts/agent-1/Anweisung.md',
    projectPath: 'C:\\Projects\\MCM_FIELD_ORGANISM',
    sha256: 'abc123',
    content: 'Prüfe zuerst den Projektstand.',
  })
  assert.match(result, /SHA-256: `abc123`/)
  assert.match(result, /C:\\Projects\\MCM_FIELD_ORGANISM\\\.codex-orchestrator\\prompts\\agent-1\\Anweisung\.md/u)
  assert.match(result, /<orchestrator_role_instruction>\nPrüfe zuerst den Projektstand\./)
  assert.match(result, /arbeite mit dem eingebetteten Inhalt weiter/)
  assert.match(result, /keine Ersatzkopie/u)
})

test('keeps absolute prompt references and resolves relative references for each platform', () => {
  assert.equal(
    absolutePromptReference('C:\\Projects\\App', '.codex-orchestrator/prompts/a/Anweisung.md'),
    'C:\\Projects\\App\\.codex-orchestrator\\prompts\\a\\Anweisung.md',
  )
  assert.equal(
    absolutePromptReference('/srv/app', '.codex-orchestrator/prompts/a/Anweisung.md'),
    '/srv/app/.codex-orchestrator/prompts/a/Anweisung.md',
  )
  assert.equal(
    absolutePromptReference('C:\\Projects\\App', 'D:\\Shared\\Anweisung.md'),
    'D:\\Shared\\Anweisung.md',
  )
})
