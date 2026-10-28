import { describe, expect, it, vi } from 'vitest'
import { createInteractiveReporter } from './terminal-smoke-interactive'

describe('createInteractiveReporter', () => {
  it('records the first parser-visible connection time and checkpoint', async () => {
    const firstConnectionMs = { current: 0 }
    const checkpointSent = { current: false }
    const reportConnected = vi.fn(async () => 1234)
    const reportReconnect = vi.fn(async () => {})
    const onReconnectCheckpoint = vi.fn()

    await createInteractiveReporter(
      reportConnected,
      reportReconnect,
      firstConnectionMs,
      checkpointSent,
      true,
      onReconnectCheckpoint,
    )()

    expect(firstConnectionMs.current).toBe(1234)
    expect(checkpointSent.current).toBe(true)
    expect(reportReconnect).toHaveBeenCalledOnce()
    expect(onReconnectCheckpoint).toHaveBeenCalledOnce()
  })

  it('does not publish a reconnect checkpoint for a normal first connection', async () => {
    const firstConnectionMs = { current: 0 }
    const checkpointSent = { current: false }
    const reportReconnect = vi.fn(async () => {})

    await createInteractiveReporter(
      async () => 0,
      reportReconnect,
      firstConnectionMs,
      checkpointSent,
      false,
    )()

    expect(firstConnectionMs.current).toBe(0)
    expect(checkpointSent.current).toBe(false)
    expect(reportReconnect).not.toHaveBeenCalled()
  })

  it('arms host wake before waiting for the reconnect IPC response', async () => {
    const checkpointSent = { current: false }
    let resolveReconnect!: () => void
    const reportReconnect = vi.fn(
      () => new Promise<void>(resolve => (resolveReconnect = resolve)),
    )
    const onReconnectCheckpoint = vi.fn()
    const reporter = createInteractiveReporter(
      async () => 1234,
      reportReconnect,
      { current: 0 },
      checkpointSent,
      true,
      onReconnectCheckpoint,
    )

    const pendingReport = reporter()
    await Promise.resolve()
    expect(onReconnectCheckpoint).toHaveBeenCalledOnce()

    resolveReconnect()
    await pendingReport
  })
})
