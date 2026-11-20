// The Inspector panel: honest numbers, no timer, no stale result posing as current.

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/locales'
import { ServerInspector } from './server-inspector-view'
import type { InspectorExec } from '@/features/inspector/inspector-probe'
import { PROBE_COMMANDS, PROBE_TTL_MS } from '@/features/inspector/server-inspector'

const LINUX_OUTPUT = [
  'os=Linux',
  'uptime=86400',
  'load=0.50 0.40 0.30',
  'mem=1000000000 250000000',
  'disk=2000000000 500000000',
].join('\n')

function exec(overrides: { detect?: string, probe?: string, reject?: boolean } = {}): InspectorExec {
  return {
    exec: vi.fn(async (_sessionId: string, command: string) => {
      if (overrides.reject) throw new Error('session is closed')
      if (command === 'uname -s') {
        return { stdout: overrides.detect ?? 'Linux', stderr: '', exitCode: 0 }
      }
      return { stdout: overrides.probe ?? LINUX_OUTPUT, stderr: '', exitCode: 0 }
    }),
  }
}

beforeEach(async () => {
  await i18n.changeLanguage('en')
})

describe('the panel shows what it collected', () => {
  it('renders metrics only after Refresh', async () => {
    // Nothing probes on mount: a panel the user opened must not query their server
    // until they ask.
    const bridge = exec()
    render(
      <ServerInspector hostId="h-1" sessionId="tab-1" exec={bridge} onClose={vi.fn()} />,
    )
    expect(bridge.exec).not.toHaveBeenCalled()
    expect(screen.queryByText('Linux')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByText('Linux')).toBeTruthy())
    expect(screen.getByText('1d 0h')).toBeTruthy()
    expect(screen.getByText('0.50 / 0.40 / 0.30')).toBeTruthy()
  })

  it('records when the reading was taken', async () => {
    render(
      <ServerInspector hostId="h-1" sessionId="tab-1" exec={exec()} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByTestId('inspector-age')).toBeTruthy())
    expect(screen.getByTestId('inspector-age').textContent).toMatch(/Observed/)
  })

  it('shows the commands that produced the numbers', async () => {
    render(
      <ServerInspector hostId="h-1" sessionId="tab-1" exec={exec()} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    // The source block lists both commands, so a number has a method behind it.
    const sourceBlock = await screen.findByText((_content, element) =>
      element?.tagName === 'PRE' &&
      (element.textContent ?? '').includes('uname -s') &&
      (element.textContent ?? '').includes('os='),
    )
    expect(sourceBlock.textContent).toContain(PROBE_COMMANDS.linux)
  })
})

describe('missing data is N/A, never zero', () => {
  it('shows N/A for a metric the server did not report', async () => {
    render(
      <ServerInspector
        hostId="h-1"
        sessionId="tab-1"
        exec={exec({ probe: 'os=Linux\nmem=\n' })}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByText('Linux')).toBeTruthy())
    // Memory absent: the row reads N/A, and no percentage line is invented.
    expect(screen.getAllByText('N/A').length).toBeGreaterThanOrEqual(3)
    expect(screen.queryByText(/% of memory in use/)).toBeNull()
  })

  it('never shows a CPU percentage it did not sample', async () => {
    render(
      <ServerInspector hostId="h-1" sessionId="tab-1" exec={exec()} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByText('Linux')).toBeTruthy())
    expect(screen.queryByText(/^\d+%$/)).toBeNull()
  })
})

describe('failures are explained', () => {
  it('reports a disconnected session', async () => {
    render(
      <ServerInspector
        hostId="h-1"
        sessionId="tab-1"
        exec={exec({ reject: true })}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByTestId('inspector-error')).toBeTruthy())
    expect(screen.getByTestId('inspector-error').textContent).toMatch(/disconnected/)
  })

  it('reports an unsupported platform rather than empty metrics', async () => {
    render(
      <ServerInspector
        hostId="h-1"
        sessionId="tab-1"
        exec={exec({ detect: 'FreeBSD' })}
        onClose={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() =>
      expect(screen.getByTestId('inspector-error').textContent).toMatch(/unsupported-platform/),
    )
  })

  it('says so when there is no session to inspect', () => {
    render(<ServerInspector hostId={null} sessionId={null} exec={exec()} onClose={vi.fn()} />)
    expect(screen.getByText(/Open a session/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh' }).hasAttribute('disabled')).toBe(true)
  })
})

describe('no timer, no resident collector', () => {
  it('does not probe again on its own', async () => {
    // The design forbids a resident collector. This waits past a plausible interval
    // and asserts the bridge was called exactly twice (detect + probe), once.
    vi.useFakeTimers()
    try {
      const bridge = exec()
      render(
        <ServerInspector hostId="h-1" sessionId="tab-1" exec={bridge} onClose={vi.fn()} />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
      await vi.waitFor(() => expect(bridge.exec).toHaveBeenCalledTimes(2))
      await vi.advanceTimersByTimeAsync(PROBE_TTL_MS * 3)
      expect(bridge.exec).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('host changes', () => {
  it('clears a result when the host changes', async () => {
    const bridge = exec()
    const { rerender } = render(
      <ServerInspector hostId="h-1" sessionId="tab-1" exec={bridge} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => expect(screen.getByText('Linux')).toBeTruthy())

    rerender(
      <ServerInspector hostId="h-2" sessionId="tab-2" exec={bridge} onClose={vi.fn()} />,
    )
    // The old reading described another machine and must not be shown as this one's.
    await waitFor(() => expect(screen.queryByText('Linux')).toBeNull())
  })
})

describe('closing', () => {
  it('calls the close handler', () => {
    const onClose = vi.fn()
    render(
      <ServerInspector hostId="h-1" sessionId="tab-1" exec={exec()} onClose={onClose} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('a probe that finishes after the host changed', () => {
  /**
   * The race the existing host test does not cover.
   *
   * `clears a result when the host changes` renders, waits for the reading, *then*
   * switches — so the old probe has already returned and only the clearing is under
   * test. The dangerous order is the other one: the user asks for a reading, switches
   * to another host while the probe is still in flight, and the slow answer arrives
   * afterwards. Showing that answer would put machine A's uptime under machine B's
   * name, which is the exact confusion the panel exists to avoid.
   *
   * `server-inspector-view.tsx` has a `generationRef` guard for this. Whether it works
   * is a different question from whether it exists, and until now nothing asked.
   */
  it('does not show host A\'s reading under host B\'s name', async () => {
    let release: (() => void) | null = null
    const slow: InspectorExec = {
      exec: vi.fn(async (_sessionId: string, command: string) => {
        if (command === 'uname -s') return { stdout: 'Linux', stderr: '', exitCode: 0 }
        // Hold the probe open until the test says so.
        await new Promise<void>(resolve => {
          release = resolve
        })
        return { stdout: LINUX_OUTPUT, stderr: '', exitCode: 0 }
      }),
    }

    const { rerender } = render(
      <ServerInspector hostId="h-1" sessionId="tab-1" exec={slow} onClose={vi.fn()} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    // The probe for h-1 is now blocked. Switch to a different host while it is open.
    await waitFor(() => expect(release).not.toBeNull())
    rerender(
      <ServerInspector hostId="h-2" sessionId="tab-2" exec={slow} onClose={vi.fn()} />,
    )

    // Let the old probe finish. Its answer belongs to h-1.
    release!()
    // Give the microtask queue room to deliver it.
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(
      screen.queryByText('Linux'),
      'host A\'s reading appeared while the panel was showing host B',
    ).toBeNull()
  })
})
