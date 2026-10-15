function recoveryAbortError() {
  const error = new Error('Workspace recovery aborted')
  error.name = 'AbortError'
  return error
}

export function throwIfRecoveryAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw recoveryAbortError()
}

export function awaitWithRecoveryAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(recoveryAbortError())

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(recoveryAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
