import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'

export function createProvisioningJournal(filePath, { createId = randomUUID, now = () => new Date() } = {}) {
  let loaded = false
  let transactions = []
  let pendingWrite = Promise.resolve()

  async function load() {
    if (loaded) return
    try {
      const parsed = JSON.parse(await readFile(filePath, 'utf8'))
      transactions = Array.isArray(parsed.transactions) ? parsed.transactions : []
    } catch {
      transactions = []
    }
    loaded = true
  }

  async function persist() {
    const temporaryFile = `${filePath}.tmp`
    await writeFile(temporaryFile, JSON.stringify({ transactions }, null, 2), 'utf8')
    await rename(temporaryFile, filePath)
  }

  function mutate(operation) {
    const result = pendingWrite.then(async () => {
      await load()
      return operation()
    })
    pendingWrite = result.then(() => undefined, () => undefined)
    return result
  }

  function create(metadata = {}) {
    return mutate(async () => {
      const transaction = {
        id: createId(),
        createdAt: now().toISOString(),
        metadata,
        threadIds: [],
      }
      transactions.push(transaction)
      await persist()
      return structuredClone(transaction)
    })
  }

  function addThread(transactionId, threadId) {
    return mutate(async () => {
      const transaction = transactions.find((item) => item.id === transactionId)
      if (!transaction) return null
      if (!transaction.threadIds.includes(threadId)) {
        transaction.threadIds.push(threadId)
        await persist()
      }
      return structuredClone(transaction)
    })
  }

  function commit(transactionId) {
    return mutate(async () => {
      const previousLength = transactions.length
      transactions = transactions.filter((item) => item.id !== transactionId)
      if (transactions.length !== previousLength) await persist()
      return transactions.length !== previousLength
    })
  }

  async function rollbackTransaction(transaction, archiveThread) {
    const failures = []
    for (const threadId of [...transaction.threadIds].reverse()) {
      try {
        await archiveThread(threadId)
      } catch (error) {
        failures.push({ threadId, error })
      }
    }
    return failures
  }

  function rollback(transactionId, archiveThread) {
    return mutate(async () => {
      const transaction = transactions.find((item) => item.id === transactionId)
      if (!transaction) return { found: false, archived: 0, failures: [] }
      const failures = await rollbackTransaction(transaction, archiveThread)
      if (failures.length === 0) {
        transactions = transactions.filter((item) => item.id !== transactionId)
        await persist()
      }
      return {
        found: true,
        archived: transaction.threadIds.length - failures.length,
        failures,
      }
    })
  }

  function recover(archiveThread, shouldPreserve = () => false) {
    return mutate(async () => {
      const results = []
      for (const transaction of [...transactions]) {
        if (await shouldPreserve(transaction)) {
          results.push({ id: transaction.id, archived: 0, failures: [], preserved: true })
          transactions = transactions.filter((item) => item.id !== transaction.id)
          continue
        }
        const failures = await rollbackTransaction(transaction, archiveThread)
        results.push({
          id: transaction.id,
          archived: transaction.threadIds.length - failures.length,
          failures,
          preserved: false,
        })
        if (failures.length === 0) {
          transactions = transactions.filter((item) => item.id !== transaction.id)
        }
      }
      await persist()
      return results
    })
  }

  async function read() {
    await pendingWrite
    await load()
    return structuredClone(transactions)
  }

  return { create, addThread, commit, rollback, recover, read }
}
