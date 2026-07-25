import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  knowledgeSourceInstruction,
  knowledgeSourcesForAgent,
  knowledgeSourcesForProject,
  type KnowledgeSource,
} from './knowledge-sources.ts'

const sources: KnowledgeSource[] = [
  { id: 'mcm', projectPath: 'C:\\MCM', name: 'MCM', type: 'repository', location: 'D:\\MCM', description: 'Core', enabled: true },
  { id: 'private', projectPath: 'C:\\MCM', name: 'Entwurf', type: 'file', location: 'D:\\draft.md', description: '', enabled: false },
  { id: 'dio', projectPath: 'C:\\DIO', name: 'DIO', type: 'folder', location: 'D:\\DIO', description: '', enabled: true },
]

test('selects knowledge sources only for the current project', () => {
  assert.deepEqual(knowledgeSourcesForProject(sources, 'C:\\MCM').map((source) => source.id), ['mcm', 'private'])
})

test('provides project knowledge only to agents with enabled access', () => {
  assert.deepEqual(knowledgeSourcesForAgent(sources, 'C:\\MCM', true).map((source) => source.id), ['mcm', 'private'])
  assert.deepEqual(knowledgeSourcesForAgent(sources, 'C:\\MCM', false), [])
})

test('builds read-only context from enabled sources only', () => {
  const instruction = knowledgeSourceInstruction(knowledgeSourcesForProject(sources, 'C:\\MCM'))
  assert.match(instruction, /MCM \[repository\]: D:\\MCM/)
  assert.match(instruction, /Verändere sie nicht/)
  assert.doesNotMatch(instruction, /Entwurf/)
  assert.doesNotMatch(instruction, /DIO/)
})
