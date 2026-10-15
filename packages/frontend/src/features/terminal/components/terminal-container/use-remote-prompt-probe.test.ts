import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ShellIntegrationEvent } from '@/features/terminal/services/terminal-shell-integration'
import { useRemotePromptProbe } from './use-remote-prompt-probe'

const mocks = vi.hoisted(() => ({
  config: null as {
    marker: string
    command: string
    expectedCwd?: string
    expectedExitCode?: number
  } | null,
  report: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/features/terminal/services/remote-prompt-probe', () => ({
  getRemotePromptProbeConfig: () => mocks.config,
  reportRemotePromptProbeObserved: mocks.report,
}))

function promptStart(): ShellIntegrationEvent {
  return { kind: 'prompt-start' }
}

function output(data: string) {
  return { data, bytes: data.length }
}

describe('useRemotePromptProbe', () => {
  beforeEach(() => {
    mocks.config = { marker: 'REMOTE_MARKER', command: 'printf marker' }
    mocks.report.mockReset()
    mocks.report.mockResolvedValue(undefined)
  })

  it('queues a prompt until the terminal input ref is ready', () => {
    const { result, rerender } = renderHook(() =>
      useRemotePromptProbe({ tabId: 'tab-1', isRemote: true }),
    )
    const input = vi.fn()

    act(() => result.current.onShellIntegration(promptStart()))
    expect(input).not.toHaveBeenCalled()

    act(() => {
      result.current.inputRef.current = input
    })
    expect(input).not.toHaveBeenCalled()

    act(() => rerender())
    expect(input).toHaveBeenCalledWith('printf marker\r', false)
  })

  it('sends only once and ignores local or non-prompt events', () => {
    const input = vi.fn()
    const { result, rerender } = renderHook(
      ({ isRemote, tabId }) => useRemotePromptProbe({ tabId, isRemote }),
      { initialProps: { isRemote: true, tabId: 'tab-1' } },
    )
    result.current.inputRef.current = input

    act(() => {
      result.current.onShellIntegration({ kind: 'command-start' })
      result.current.onShellIntegration(promptStart())
      result.current.onShellIntegration(promptStart())
    })
    expect(input).toHaveBeenCalledTimes(1)

    rerender({ isRemote: false, tabId: 'tab-1' })
    act(() => result.current.onShellIntegration(promptStart()))
    expect(input).toHaveBeenCalledTimes(1)
  })

  it('reports a marker split across output chunks only once', async () => {
    const { result } = renderHook(() =>
      useRemotePromptProbe({ tabId: 'tab-1', isRemote: true }),
    )

    act(() => {
      result.current.onOutput(output('prefix\nREMOTE_'))
      result.current.onOutput(output('MARKER\nnext'))
      result.current.onOutput(output('\nREMOTE_MARKER\n'))
    })
    await act(async () => {})

    expect(mocks.report).toHaveBeenCalledOnce()
  })

  it('reports a marker adjacent to an OSC sequence in the same output chunk', async () => {
    const { result } = renderHook(() =>
      useRemotePromptProbe({ tabId: 'tab-1', isRemote: true }),
    )

    act(() => result.current.onOutput(output('\u001b]133;B\u0007REMOTE_MARKER\r\n')))
    await act(async () => {})

    expect(mocks.report).toHaveBeenCalledOnce()
  })

  it('waits for prompt, cwd, and non-zero exit evidence before reporting', async () => {
    mocks.config = {
      marker: 'REMOTE_MARKER',
      command: 'printf marker; false',
      expectedCwd: '/tmp/fixture/home',
      expectedExitCode: 1,
    }
    const { result } = renderHook(() =>
      useRemotePromptProbe({ tabId: 'tab-1', isRemote: true }),
    )
    const input = vi.fn()
    result.current.inputRef.current = input

    act(() => result.current.onOutput(output('REMOTE_MARKER\n')))
    expect(mocks.report).not.toHaveBeenCalled()
    act(() => result.current.onShellIntegration({ kind: 'cwd', cwd: '/tmp/fixture/home' }))
    expect(mocks.report).not.toHaveBeenCalled()
    act(() => result.current.onShellIntegration(promptStart()))
    expect(input).toHaveBeenCalledWith('printf marker; false\r', false)
    act(() =>
      result.current.onShellIntegration({
        kind: 'command-finished',
        exitCode: 1,
      }),
    )
    await act(async () => {})
    expect(mocks.report).toHaveBeenCalledOnce()
  })

  it('checks a large event before trimming the output ring', async () => {
    const { result } = renderHook(() =>
      useRemotePromptProbe({ tabId: 'tab-1', isRemote: true }),
    )
    const largeOutput = `${'x'.repeat(8_192)}\nREMOTE_MARKER\n`

    act(() => result.current.onOutput(output(largeOutput)))
    await act(async () => {})

    expect(mocks.report).toHaveBeenCalledOnce()
  })

  it('does not report non-markers and recovers after a tab changes', () => {
    const { result, rerender } = renderHook(
      ({ tabId }) => useRemotePromptProbe({ tabId, isRemote: true }),
      { initialProps: { tabId: 'tab-1' } },
    )
    act(() => result.current.onOutput(output('REMOTE_MARKERX\n')))
    expect(mocks.report).not.toHaveBeenCalled()

    rerender({ tabId: 'tab-2' })
    act(() => result.current.onOutput(output('REMOTE_MARKER\n')))
    expect(mocks.report).toHaveBeenCalledOnce()
  })

  it('logs but does not throw when reporting fails', async () => {
    const error = new Error('probe unavailable')
    mocks.report.mockRejectedValue(error)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() =>
      useRemotePromptProbe({ tabId: 'tab-1', isRemote: true }),
    )

    act(() => result.current.onOutput(output('REMOTE_MARKER\n')))
    await act(async () => {})

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to report remote prompt probe:',
      error,
    )
    consoleError.mockRestore()
  })
})
