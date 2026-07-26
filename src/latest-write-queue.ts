export function createLatestWriteQueue() {
  let latestRevision = 0
  let pending = Promise.resolve()

  return {
    nextRevision() {
      latestRevision += 1
      return latestRevision
    },
    enqueue(revision: number, write: (isLatest: () => boolean) => Promise<void>) {
      const execute = async () => {
        if (revision !== latestRevision) return
        await write(() => revision === latestRevision)
      }
      pending = pending.then(execute, execute)
      return pending
    },
  }
}
