export type ProvisioningTransaction = {
  addRollback(action: () => Promise<void>): void
}

export class ProvisioningTransactionError extends Error {
  readonly cause: unknown
  readonly rollbackErrors: unknown[]

  constructor(cause: unknown, rollbackErrors: unknown[]) {
    const message = cause instanceof Error ? cause.message : 'Team provisioning failed.'
    super(
      rollbackErrors.length > 0
        ? `${message} Cleanup failed for ${rollbackErrors.length} resource(s).`
        : message,
    )
    this.name = 'ProvisioningTransactionError'
    this.cause = cause
    this.rollbackErrors = rollbackErrors
  }
}

export async function runProvisioningTransaction<T>(
  operation: (transaction: ProvisioningTransaction) => Promise<T>,
): Promise<T> {
  const rollbackActions: Array<() => Promise<void>> = []

  try {
    return await operation({
      addRollback(action) {
        rollbackActions.push(action)
      },
    })
  } catch (cause) {
    const rollbackResults = await Promise.allSettled(
      rollbackActions.reverse().map((action) => action()),
    )
    const rollbackErrors = rollbackResults
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason)
    throw new ProvisioningTransactionError(cause, rollbackErrors)
  }
}
