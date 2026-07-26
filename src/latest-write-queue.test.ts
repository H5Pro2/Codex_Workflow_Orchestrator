import assert from 'node:assert/strict'
import test from 'node:test'
import { createLatestWriteQueue } from './latest-write-queue.ts'

test('serializes writes and keeps an in-flight stale completion from winning', async () => {
  const queue = createLatestWriteQueue()
  const completions: string[] = []
  let releaseFirst = () => {}
  const firstBlocked = new Promise<void>((resolve) => {
    releaseFirst = resolve
  })

  const firstRevision = queue.nextRevision()
  const first = queue.enqueue(firstRevision, async (isLatest) => {
    await firstBlocked
    if (isLatest()) completions.push('start')
  })
  await Promise.resolve()

  const stopRevision = queue.nextRevision()
  const stop = queue.enqueue(stopRevision, async (isLatest) => {
    if (isLatest()) completions.push('stop')
  })
  releaseFirst()
  await Promise.all([first, stop])

  assert.deepEqual(completions, ['stop'])
})

test('skips a queued snapshot superseded before it starts', async () => {
  const queue = createLatestWriteQueue()
  const writes: string[] = []
  const staleRevision = queue.nextRevision()
  const latestRevision = queue.nextRevision()
  await Promise.all([
    queue.enqueue(staleRevision, async () => { writes.push('stale') }),
    queue.enqueue(latestRevision, async () => { writes.push('latest') }),
  ])
  assert.deepEqual(writes, ['latest'])
})
