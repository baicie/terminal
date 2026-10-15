export function createInteractiveReporter(
  reportConnected: () => Promise<number>,
  reportReconnect: () => Promise<void>,
  firstConnectionMs: { current: number },
  checkpointSent: { current: boolean },
  notifyReconnect: boolean,
): () => Promise<void> {
  return async () => {
    const elapsedMs = await reportConnected()
    if (
      Number.isSafeInteger(elapsedMs) &&
      elapsedMs > 0 &&
      firstConnectionMs.current === 0
    ) {
      firstConnectionMs.current = elapsedMs
    }
    if (notifyReconnect && !checkpointSent.current) {
      checkpointSent.current = true
      await reportReconnect()
    }
  }
}
