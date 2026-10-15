import { describe, expect, it, vi } from 'vitest'
import { createInteractiveReporter } from './terminal-smoke-interactive'

describe('createInteractiveReporter', () => {
  it('records the first parser-visible connection time and checkpoint', async () => {
    const firstConnectionMs = { current: 0 }
    const checkpointSent = { current: false }
    const reportConnected = vi.fn(async () => 1234)
    const reportReconnect = vi.fn(async () => {})

    await createInteractiveReporter(
      reportConnected,
      reportReconnect,
      firstConnectionMs,
      checkpointSent,
      true,
    )()

    expect(firstConnectionMs.current).toBe(1234)
    expect(checkpointSent.current).toBe(true)
    expect(reportReconnect).toHaveBeenCalledOnce()
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
})
