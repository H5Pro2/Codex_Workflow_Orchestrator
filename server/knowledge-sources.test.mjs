import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  knowledgeSourcesFile,
  normalizeKnowledgeSources,
  readKnowledgeSources,
  writeKnowledgeSources,
} from './knowledge-sources.mjs'

test('normalizes valid project knowledge sources and rejects invalid entries', () => {
  assert.deepEqual(normalizeKnowledgeSources([
    { id: 'mcm', name: ' MCM ', type: 'repository', location: ' C:\\MCM ', description: ' Core ', enabled: true },
    { id: 'invalid', name: '', type: 'url', location: 'https://example.com' },
  ]), [{
    id: 'mcm',
    name: 'MCM',
    type: 'repository',
    location: 'C:\\MCM',
    description: 'Core',
    enabled: true,
  }])
})

test('stores knowledge sources inside the selected project', async () => {
  const projectPath = await mkdtemp(join(tmpdir(), 'orchestrator-knowledge-'))
  const sources = [{
    id: 'study',
    name: 'Neurologische Studie',
    type: 'file',
    location: 'C:\\Research\\study.pdf',
    description: '',
    enabled: false,
  }]
  try {
    assert.deepEqual(await readKnowledgeSources(projectPath), [])
    assert.deepEqual(await writeKnowledgeSources(projectPath, sources), sources)
    assert.deepEqual(await readKnowledgeSources(projectPath), sources)
    const stored = JSON.parse(await readFile(knowledgeSourcesFile(projectPath), 'utf8'))
    assert.equal(stored.version, 1)
  } finally {
    await rm(projectPath, { recursive: true, force: true })
  }
})
