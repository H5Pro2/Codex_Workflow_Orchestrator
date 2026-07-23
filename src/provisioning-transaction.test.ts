import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ProvisioningTransactionError,
  runProvisioningTransaction,
} from './provisioning-transaction.ts'

test('rolls back all created connector resources in reverse order after a partial failure', async () => {
  const created: string[] = []
  const archived: string[] = []

  await assert.rejects(
    runProvisioningTransaction(async ({ addRollback }) => {
      for (const name of ['CEO', 'Developer', 'QA']) {
        if (name === 'QA') throw new Error('Connector unavailable')
        created.push(name)
        addRollback(async () => {
          archived.push(name)
        })
      }
    }),
    (error) => {
      assert.ok(error instanceof ProvisioningTransactionError)
      assert.equal(error.message, 'Connector unavailable')
      assert.deepEqual(error.rollbackErrors, [])
      return true
    },
  )

  assert.deepEqual(created, ['CEO', 'Developer'])
  assert.deepEqual(archived, ['Developer', 'CEO'])
})

test('keeps created resources when the complete operation succeeds', async () => {
  const archived: string[] = []
  const result = await runProvisioningTransaction(async ({ addRollback }) => {
    addRollback(async () => {
      archived.push('CEO')
    })
    return 'committed'
  })

  assert.equal(result, 'committed')
  assert.deepEqual(archived, [])
})

test('reports cleanup failures without hiding the original connector error', async () => {
  await assert.rejects(
    runProvisioningTransaction(async ({ addRollback }) => {
      addRollback(async () => {
        throw new Error('Archive failed')
      })
      throw new Error('Prompt upload failed')
    }),
    (error) => {
      assert.ok(error instanceof ProvisioningTransactionError)
      assert.match(error.message, /Prompt upload failed/)
      assert.equal(error.rollbackErrors.length, 1)
      return true
    },
  )
})
