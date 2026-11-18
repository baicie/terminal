import { StrictMode } from 'react'
import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/locales'
import { ServerInspector } from './server-inspector-view'
import { PROBE_TTL_MS, type ProbeResult } from '@/features/inspector/server-inspector'

function result(observedAt: number): ProbeResult {
  return {
    hostId: 'h-1', sessionId: 'ssh-1', observedAt, ttlMs: PROBE_TTL_MS, samplingWindowMs: null,
    metrics: { os: 'Linux 6.1', uptimeSeconds: 3600, load1: 0.1, load5: 0.2, load15: 0.3,
      cpuPercent: null, memoryUsedBytes: 1024, memoryTotalBytes: 2048, diskUsedBytes: 512, diskTotalBytes: 4096 },
    notes: [], source: ['uname -s', 'free -b'],
  }
}

beforeEach(async () => { await i18n.changeLanguage('en'); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('StrictMode double-effect', () => {
  it('still has exactly one interval, and stale still lands', async () => {
    const exec = { exec: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })) }
    const observedAt = Date.now()
    const view = render(
      <StrictMode>
        <ServerInspector hostId="h-1" sessionId="ssh-1" exec={exec} onClose={() => undefined}
          probe={async () => ({ ok: true as const, result: result(observedAt) })} />
      </StrictMode>,
    )
    await act(async () => {
      screen.getByRole('button', { name: /refresh/i }).click()
      await Promise.resolve()
    })
    const timers = vi.getTimerCount()
    await act(async () => { vi.advanceTimersByTime(PROBE_TTL_MS + 2_000) })
    const badged = screen.queryByTestId('inspector-stale-badge') !== null
    view.unmount()
    console.log(JSON.stringify({ timers, badged, afterUnmount: vi.getTimerCount() }))
    expect(timers).toBe(1)
    expect(badged).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
