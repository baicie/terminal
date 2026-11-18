import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/locales'
import { ServerInspector } from './zz-tmp-leak-view'
import { PROBE_TTL_MS, type ProbeResult } from '@/features/inspector/server-inspector'

function result(observedAt: number): ProbeResult {
  return {
    hostId: 'h-1', sessionId: 'ssh-1', observedAt, ttlMs: PROBE_TTL_MS,
    samplingWindowMs: null,
    metrics: { os: 'Linux 6.1', uptimeSeconds: 3600, load1: 0.1, load5: 0.2, load15: 0.3,
      cpuPercent: null, memoryUsedBytes: 1024, memoryTotalBytes: 2048, diskUsedBytes: 512, diskTotalBytes: 4096 },
    notes: [], source: ['uname -s', 'free -b'],
  }
}

beforeEach(async () => { await i18n.changeLanguage('en'); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('timer accounting', () => {
  it('reports the timer count at each step', async () => {
    const exec = { exec: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })) }
    const before = vi.getTimerCount()
    const view = render(
      <ServerInspector hostId="h-1" sessionId="ssh-1" exec={exec} onClose={() => undefined}
        probe={async () => ({ ok: true as const, result: result(Date.now()) })} />,
    )
    const afterMount = vi.getTimerCount()
    await act(async () => {
      screen.getByRole('button', { name: /refresh/i }).click()
      await Promise.resolve()
    })
    const afterResult = vi.getTimerCount()
    // Extra renders must not add a second interval.
    await act(async () => { vi.advanceTimersByTime(5_000) })
    const afterFiveTicks = vi.getTimerCount()
    view.unmount()
    const afterUnmount = vi.getTimerCount()
    console.log(JSON.stringify({ before, afterMount, afterResult, afterFiveTicks, afterUnmount }))
    expect(afterUnmount).toBe(before)
  })
})
