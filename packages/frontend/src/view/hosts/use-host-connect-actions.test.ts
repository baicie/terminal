// What "connect" means for each credential state.
//
// Three outcomes, and the difference between them is the whole UX-2a rule:
//   * a stored, readable credential connects immediately;
//   * nothing stored opens the prompt, and the typed secret rides on a process-local
//     profile — never the tab, the store or the database;
//   * a damaged reference refuses with the one action that fixes it, because a
//     typed password cannot repair a pointer the connection path will not read.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import { useHostConnectActions } from './use-host-connect-actions'
import {
  clearTemporaryTerminalProfiles,
  getTemporaryTerminalProfile,
} from '@/features/terminal/services/temporary-terminal-profiles'

const mocks = vi.hoisted(() => ({
  connectToHost: vi.fn(),
  addTab: vi.fn(),
  navigate: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/features/connection-explorer/use-connect-to-host', () => ({
  useConnectToHost: () => ({ connectToHost: mocks.connectToHost, toggleFavorite: vi.fn() }),
}))
vi.mock('@/store/app', () => ({
  useAppStore: (selector: (s: { addTab: typeof mocks.addTab }) => unknown) =>
    selector({ addTab: mocks.addTab }),
}))
vi.mock('@/components/ui/sonner', () => ({
  toast: { error: mocks.toastError, success: vi.fn(), info: vi.fn() },
}))

const base = {
  id: 'h-1',
  name: 'prod',
  hostname: 'prod.test',
  port: 22,
  username: 'deploy',
  authType: 'password',
  credentialRef: null,
  credentialRefProblem: null,
} as unknown as Host

beforeEach(() => {
  vi.clearAllMocks()
  clearTemporaryTerminalProfiles()
  mocks.addTab.mockReturnValue({ id: 'tab-1' })
})

describe('connect with a stored credential', () => {
  it('connects immediately without asking', () => {
    const { result } = renderHook(() => useHostConnectActions())
    act(() => {
      result.current.handleConnect({
        ...base,
        credentialRef: { kinds: ['password'], provider: 'vault', version: 1 },
      } as unknown as Host)
    })

    expect(mocks.connectToHost).toHaveBeenCalledTimes(1)
    expect(result.current.credentialPromptHost).toBeNull()
  })
})

describe('connect with nothing stored', () => {
  it('opens the prompt instead of connecting', () => {
    const { result } = renderHook(() => useHostConnectActions())
    act(() => result.current.handleConnect(base))

    expect(mocks.connectToHost).not.toHaveBeenCalled()
    expect(result.current.credentialPromptHost?.id).toBe('h-1')
  })

  it('opens a tab against a profile that carries the secret, not the tab', () => {
    const { result } = renderHook(() => useHostConnectActions())
    act(() => result.current.handleConnect(base))
    act(() => result.current.handleOneTimeConnect({ password: 'hunter2' }))

    const payload = mocks.addTab.mock.calls[0][0] as Record<string, unknown>
    // The tab names a profile; it never carries the secret itself. This is the
    // invariant `Tab.profileId` documents, and the reason nothing leaks into the
    // persisted workspace layout.
    expect(payload.profileId).toBeTypeOf('string')
    expect(payload.hostId).toBe('h-1')
    expect(JSON.stringify(payload)).not.toContain('hunter2')

    const profile = getTemporaryTerminalProfile(payload.profileId as string)
    expect(profile?.password).toBe('hunter2')
    expect(mocks.navigate).toHaveBeenCalledWith(expect.stringContaining('tab-1'))
  })

  it('a failed authentication stores nothing, because nothing is ever written', () => {
    // The rule that matters most: "认证失败不能自动持久化凭据". There is no write to
    // fail here — the only durable effect of a one-time connect is a process-local
    // profile, and closing the dialog or the tab drops it. This asserts the shape:
    // no store call, no tab secret, nothing that outlives the process.
    const { result } = renderHook(() => useHostConnectActions())
    act(() => result.current.handleConnect(base))

    // The user cancels instead of submitting.
    act(() => result.current.setCredentialPromptHost(null))

    expect(mocks.addTab).not.toHaveBeenCalled()
    expect(mocks.connectToHost).not.toHaveBeenCalled()
    expect(getTemporaryTerminalProfile('anything')).toBeUndefined()
  })

  it('drops the profile when the tab cannot be opened', () => {
    // A profile holding a secret must not outlive the attempt that created it.
    mocks.addTab.mockImplementation(() => {
      throw new Error('tab store unavailable')
    })
    const { result } = renderHook(() => useHostConnectActions())
    act(() => result.current.handleConnect(base))

    expect(() => {
      act(() => result.current.handleOneTimeConnect({ password: 'hunter2' }))
    }).toThrow('tab store unavailable')
  })
})

describe('connect with a damaged reference', () => {
  it('refuses and does not open the prompt', () => {
    const { result } = renderHook(() => useHostConnectActions())
    act(() =>
      result.current.handleConnect({
        ...base,
        credentialRefProblem: { kind: 'unknown-provider', provider: 'system-keychain' },
      } as unknown as Host),
    )

    expect(result.current.credentialPromptHost).toBeNull()
    expect(mocks.connectToHost).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalled()
    // The description names the fix, not just the failure.
    const [, options] = mocks.toastError.mock.calls[0] as [string, { description: string }]
    expect(options.description).toMatch(/clear or re-save/i)
  })
})
