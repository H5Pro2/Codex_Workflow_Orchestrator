import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deletePromptDirectory, promptContentSha256, writeVerifiedPromptFile } from './prompt-files.mjs'

test('writes a prompt atomically and verifies its content', async () => {
  const projectPath = await mkdtemp(join(tmpdir(), 'codex-prompt-'))
  const content = 'Prüfe den Projektstand vollständig.\n'
  const result = await writeVerifiedPromptFile({
    projectPath,
    agentId: 'agent-1',
    fileName: 'Anweisung.md',
    content,
  })
  assert.equal(result.path, join(projectPath, '.codex-orchestrator', 'prompts', 'agent-1', 'Anweisung.md'))
  assert.equal(result.relativePath, '.codex-orchestrator/prompts/agent-1/Anweisung.md')
  assert.equal(result.sha256, promptContentSha256(content))
  assert.equal(await readFile(result.path, 'utf8'), content)

  const replacement = await writeVerifiedPromptFile({
    projectPath,
    agentId: 'agent-1',
    fileName: 'Anweisung.md',
    content: 'Neue geprüfte Anweisung.',
  })
  assert.equal(replacement.path, result.path)
  assert.equal(await readFile(result.path, 'utf8'), 'Neue geprüfte Anweisung.')
})

test('rejects unsafe prompt paths', async () => {
  const projectPath = await mkdtemp(join(tmpdir(), 'codex-prompt-'))
  await assert.rejects(
    writeVerifiedPromptFile({
      projectPath,
      agentId: 'agent-1',
      fileName: '../Anweisung.md',
      content: 'Inhalt',
    }),
    /gültiger Dateiname/,
  )
})

test('deletes one agent prompt directory and allows missing directories', async () => {
  const projectPath = await mkdtemp(join(tmpdir(), 'codex-prompt-'))
  const first = await writeVerifiedPromptFile({
    projectPath,
    agentId: 'agent-1',
    fileName: 'Anweisung.md',
    content: 'Agent 1',
  })
  const second = await writeVerifiedPromptFile({
    projectPath,
    agentId: 'agent-2',
    fileName: 'Anweisung.md',
    content: 'Agent 2',
  })

  const result = await deletePromptDirectory({ projectPath, agentId: 'agent-1' })
  assert.equal(result.relativePath, '.codex-orchestrator/prompts/agent-1')
  await assert.rejects(readFile(first.path, 'utf8'), /ENOENT/)
  assert.equal(await readFile(second.path, 'utf8'), 'Agent 2')

  await deletePromptDirectory({ projectPath, agentId: 'agent-1' })
})
