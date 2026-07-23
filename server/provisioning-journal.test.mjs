import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { createProvisioningJournal } from './provisioning-journal.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true }),
  ))
})

async function createJournal() {
  const directory = await mkdtemp(join(tmpdir(), 'codex-orchestrator-journal-'))
  temporaryDirectories.push(directory)
  const filePath = join(directory, 'journal.json')
  let nextId = 1
  return {
    filePath,
    journal: createProvisioningJournal(filePath, {
      createId: () => `transaction-${nextId++}`,
      now: () => new Date('2026-07-23T12:00:00.000Z'),
    }),
  }
}

test('recovers an interrupted transaction after a connector restart', async () => {
  const { filePath, journal } = await createJournal()
  const transaction = await journal.create({ projectPath: 'C:/project' })
  await journal.addThread(transaction.id, 'thread-ceo')
  await journal.addThread(transaction.id, 'thread-developer')

  const restartedJournal = createProvisioningJournal(filePath)
  const archived = []
  const recovery = await restartedJournal.recover(async (threadId) => {
    archived.push(threadId)
  })

  assert.deepEqual(archived, ['thread-developer', 'thread-ceo'])
  assert.equal(recovery[0].archived, 2)
  assert.deepEqual(await restartedJournal.read(), [])
})

test('committing a transaction preserves its threads and removes the journal entry', async () => {
  const { filePath, journal } = await createJournal()
  const transaction = await journal.create()
  await journal.addThread(transaction.id, 'thread-ceo')
  assert.equal(await journal.commit(transaction.id), true)

  const restartedJournal = createProvisioningJournal(filePath)
  const archived = []
  await restartedJournal.recover(async (threadId) => archived.push(threadId))

  assert.deepEqual(archived, [])
  assert.deepEqual(await restartedJournal.read(), [])
})

test('retains a transaction when recovery cannot archive every thread', async () => {
  const { filePath, journal } = await createJournal()
  const transaction = await journal.create()
  await journal.addThread(transaction.id, 'thread-ceo')

  const recovery = await journal.recover(async () => {
    throw new Error('Codex unavailable')
  })

  assert.equal(recovery[0].failures.length, 1)
  assert.equal((await journal.read())[0].id, transaction.id)

  const restartedJournal = createProvisioningJournal(filePath)
  await restartedJournal.recover(async () => undefined)
  assert.deepEqual(await restartedJournal.read(), [])
})

test('preserves a committed team when the browser closed before clearing its journal', async () => {
  const { filePath, journal } = await createJournal()
  const transaction = await journal.create({
    managerAgentId: 'manager',
    signature: 'team-v1',
  })
  await journal.addThread(transaction.id, 'thread-ceo')

  const restartedJournal = createProvisioningJournal(filePath)
  const archived = []
  const recovery = await restartedJournal.recover(
    async (threadId) => archived.push(threadId),
    async (pending) => pending.metadata.signature === 'team-v1',
  )

  assert.equal(recovery[0].preserved, true)
  assert.deepEqual(archived, [])
  assert.deepEqual(await restartedJournal.read(), [])
})
