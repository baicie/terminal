import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Tab } from '@/types'
import { useTerminalSessionBinding } from './use-terminal-session-binding'

const mocks = vi.hoisted(() => ({
  useTerminal: vi.fn(),
  useSshHostKeyGate: vi.fn(),
}))

vi.mock('@/hooks/use-terminal', () => ({ useTerminal: mocks.useTerminal }))
vi.mock('@/features/terminal/hooks/use-ssh-host-key-gate', () => ({
  useSshHostKeyGate: mocks.useSshHostKeyGate,
}))

const remoteTab: Tab = {
  id: 'remote-one',
  label: 'Production',
  type: 'remote',
  hostId: 'host-one',
}

function options(tab: Tab | undefined) {
  return {
    termInstance: null,
    tabId: 'remote-one',
    workspaceId: 'workspace-one',
    tab,
    host: undefined,
    jumpHost: undefined,
    outputWriter: undefined,
    onOutput: vi.fn(),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.useSshHostKeyGate.mockReturnValue({
    status: 'ready',
    role: null,
    enabled: true,
    prompt: null,
    saving: false,
    error: null,
    trustOnce: vi.fn(),
    trustAndSave: vi.fn(),
    cancel: vi.fn(),
    retry: vi.fn(),
  })
  mocks.useTerminal.mockReturnValue({
    status: 'idle',
    error: null,
    write: vi.fn(),
    reconnect: vi.fn(),
    disconnect: vi.fn(),
  })
})

describe('useTerminalSessionBinding tab lifecycle', () => {
  it('does not start a local session while the tab is briefly missing', () => {
    renderHook(() => useTerminalSessionBinding(options(undefined)))

    expect(mocks.useTerminal).toHaveBeenCalledOnce()
    expect(mocks.useTerminal.mock.calls[0][1]).toMatchObject({
      tabType: 'local',
      enabled: false,
    })
  })

  it('starts the restored remote session once its tab exists again', () => {
    const { rerender } = renderHook(
      ({ tab }: { tab: Tab | undefined }) =>
        useTerminalSessionBinding(options(tab)),
      { initialProps: { tab: undefined as Tab | undefined } },
    )

    expect(mocks.useTerminal.mock.calls[0][1]).toMatchObject({
      enabled: false,
    })

    rerender({ tab: remoteTab })

    expect(mocks.useTerminal.mock.calls.at(-1)?.[1]).toMatchObject({
      tabType: 'remote',
      enabled: true,
    })
  })
})
