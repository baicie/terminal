function recoveryAbortError() {
  const error = new Error('Workspace recovery aborted')
  error.name = 'AbortError'
  return error
}

function recoveryTimeoutError() {
  const error = new Error('Workspace recovery timed out')
  error.name = 'TimeoutError'
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

export function awaitWithRecoveryTimeout<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<T> {
  if (signal?.aborted) return Promise.reject(recoveryAbortError())
  if (timeoutMs <= 0) return Promise.reject(recoveryTimeoutError())

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      finish(false, undefined, recoveryTimeoutError())
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    const finish = (ok: boolean, value?: T, error?: unknown) => {
      if (settled) return
      settled = true
      cleanup()
      if (ok) resolve(value as T)
      else reject(error)
    }
    const onAbort = () => finish(false, undefined, recoveryAbortError())
    signal?.addEventListener('abort', onAbort, { once: true })
    promise.then(
      value => {
        finish(true, value)
      },
      error => {
        finish(false, undefined, error)
      },
    )
  })
}
