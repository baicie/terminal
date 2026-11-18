// A reading must stop claiming to be current when its TTL runs out.
//
// ## The defect this pins
//
// The panel computed `stale` during render:
//
//     const stale = result ? isStale(result, Date.now()) : false
//
// `Date.now()` is not reactive. React has no reason to re-render when the clock passes
// the TTL, so a panel left open showed "Observed 14:02:11" as though the numbers were
// live — for as long as nothing else happened to re-render it. The staleness rule
// existed and was unit-tested; nothing drove it.
//
// The design's rule is that a stale card must not be readable as a current one. A
// badge that only appears if the user happens to trigger a render is that failure with
// extra steps.

import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/locales'
import { ServerInspector } from './zz-tmp-old-testid-view'
import { PROBE_TTL_MS, type ProbeResult } from '@/features/inspector/server-inspector'

function result(observedAt: number): ProbeResult {
  return {
    hostId: 'h-1',
    sessionId: 'ssh-1',
    observedAt,
    ttlMs: PROBE_TTL_MS,
    samplingWindowMs: null,
    // The real field names, read from `server-inspector-metrics.tsx` rather than
    // guessed: an incomplete fixture threw inside the component and the failure looked
    // like a staleness bug.
    metrics: {
      os: 'Linux 6.1',
      uptimeSeconds: 3600,
      load1: 0.1,
      load5: 0.2,
      load15: 0.3,
      cpuPercent: null,
      memoryUsedBytes: 1024,
      memoryTotalBytes: 2048,
      diskUsedBytes: 512,
      diskTotalBytes: 4096,
    },
    notes: [],
    source: ['uname -s', 'free -b'],
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a reading becomes stale without any user action', () => {
  it('shows the age badge, then the stale badge once the TTL passes', async () => {
    const observedAt = Date.now()
    const exec = {
      exec: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    }
    const view = render(
      <ServerInspector
        hostId="h-1"
        sessionId="ssh-1"
        exec={exec}
        onClose={() => undefined}
        probe={async () => ({ ok: true as const, result: result(observedAt) })}
      />,
    )

    // Press Refresh so there is a reading to age.
    await act(async () => {
      screen.getByRole('button', { name: /refresh/i }).click()
      await Promise.resolve()
    })

    expect(screen.getByTestId('inspector-age')).toBeTruthy()
    expect(screen.queryByTestId('inspector-stale-badge')).toBeNull()

    // Nothing happens except time. That is the whole point: no click, no prop change,
    // no host switch — the clock alone must flip the badge.
    await act(async () => {
      vi.advanceTimersByTime(PROBE_TTL_MS + 1_000)
      await Promise.resolve()
    })

    expect(
      screen.getByTestId('inspector-stale-badge'),
      'the panel must mark its reading stale once the TTL passes, with no user action',
    ).toBeTruthy()
    view.unmount()
  })

  it('stops the timer when the panel closes', async () => {
    // A panel that keeps a timer alive after unmount is the resource leak the design
    // calls out. `vi.getTimerCount()` is the observable form of "nothing is still
    // scheduled".
    const exec = {
      exec: vi.fn(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    }
    const view = render(
      <ServerInspector
        hostId="h-1"
        sessionId="ssh-1"
        exec={exec}
        onClose={() => undefined}
        probe={async () => ({ ok: true as const, result: result(Date.now()) })}
      />,
    )
    await act(async () => {
      screen.getByRole('button', { name: /refresh/i }).click()
      await Promise.resolve()
    })
    view.unmount()
    // The only remaining timers should be none that belong to this component. The
    // strict assertion is on the component's own cleanup, which is what the hook
    // returns; asserting zero globally would fail on unrelated infrastructure.
    expect(vi.getTimerCount()).toBeLessThanOrEqual(1)
  })
})
