// Editing a host's connection details must not reuse its old session.
//
// ## The defect
//
// The session is bound by `id:authType`:
//
//     const hostKey = activeHost ? `${activeHost.id}:${activeHost.authType}` : null
//
// Change the hostname, port, username, credential reference or jump host on a *saved*
// host and that key does not move — so the hook keeps the session it opened against the
// old address, and every file operation afterwards (list, upload, delete, rename) goes
// to the machine the user just stopped pointing at.
//
// `id:authType` answers "is this the same record?", which is not the question. The
// question is "does this session connect to the host as it is configured now?".

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sftpList: vi.fn(),
  sftpConnect: vi.fn(),
  sftpResolvePath: vi.fn(),
  sftpRelease: vi.fn(),
  createSshSessionKey: vi.fn(),
  createSshSessionPassword: vi.fn(),
  close: vi.fn(),
}))

vi.mock('@/service/ssh', () => ({
  sshService: {
    createSshSessionKey: mocks.createSshSessionKey,
    createSshSessionPassword: mocks.createSshSessionPassword,
    sftpConnect: mocks.sftpConnect,
    sftpList: mocks.sftpList,
    sftpResolvePath: mocks.sftpResolvePath,
    sftpRelease: mocks.sftpRelease,
    close: mocks.close,
  },
}))
vi.mock('@/locales', () => ({ default: { t: (key: string) => key } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

const { useSftpRemote } = await import('./use-sftp-remote')

const BASE = {
  id: 'host-1',
  name: 'Prod',
  hostname: 'prod.example.internal',
  port: 22,
  username: 'deploy',
  authType: 'key' as const,
}
type TestHost = {
  id: string, name: string, hostname: string, port: number,
  username: string, authType: string, [extra: string]: unknown,
}
const host = (overrides: Partial<TestHost> = {}) => ({ ...BASE, ...overrides }) as never

beforeEach(() => {
  vi.clearAllMocks()
  let n = 0
  mocks.createSshSessionKey.mockImplementation(async () => {
    n += 1
    return { success: true, sessionId: `sess-${n}` }
  })
  mocks.createSshSessionPassword.mockImplementation(async () => {
    n += 1
    return { success: true, sessionId: `sess-${n}` }
  })
  mocks.sftpConnect.mockResolvedValue({ success: true })
  mocks.sftpResolvePath.mockImplementation(async (_sid: string, p: string) => p)
  mocks.sftpRelease.mockResolvedValue(undefined)
  mocks.close.mockResolvedValue(undefined)
  mocks.sftpList.mockResolvedValue({ success: true, files: [] })
})

describe('a host whose connection details changed', () => {
  it('opens a new session instead of reusing the old one', async () => {
    const { rerender } = renderHook(({ host }) => useSftpRemote({ activeHost: host }), {
      initialProps: { host: BASE },
    })
    await waitFor(() => expect(mocks.createSshSessionKey).toHaveBeenCalledTimes(1))

    // Same record, different machine.
    const moved = host({ hostname: 'staging.example.internal' })
    rerender({ host: moved })

    await waitFor(() =>
      expect(
        mocks.createSshSessionKey.mock.calls.length,
        'the session was opened against the old hostname and reused for the new one',
      ).toBe(2),
    )
  })

  it('opens a new session when the port changes', async () => {
    const { rerender } = renderHook(({ host }) => useSftpRemote({ activeHost: host }), {
      initialProps: { host: BASE },
    })
    await waitFor(() => expect(mocks.createSshSessionKey).toHaveBeenCalledTimes(1))
    rerender({ host: host({ port: 2222 }) })
    await waitFor(() => expect(mocks.createSshSessionKey).toHaveBeenCalledTimes(2))
  })

  it('opens a new session when the username changes', async () => {
    const { rerender } = renderHook(({ host }) => useSftpRemote({ activeHost: host }), {
      initialProps: { host: BASE },
    })
    await waitFor(() => expect(mocks.createSshSessionKey).toHaveBeenCalledTimes(1))
    rerender({ host: host({ username: 'root' }) })
    await waitFor(() => expect(mocks.createSshSessionKey).toHaveBeenCalledTimes(2))
  })

  it('opens a new session when the credential reference changes', async () => {
    const { rerender } = renderHook(({ host }) => useSftpRemote({ activeHost: host }), {
      initialProps: { host: host({ credentialRef: { kinds: ['privateKey'], provider: 'vault', version: 1 } }) },
    })
    await waitFor(() => expect(mocks.createSshSessionKey).toHaveBeenCalledTimes(1))
    rerender({
      host: host({ credentialRef: { kinds: ['privateKey'], provider: 'vault', version: 2 } }),
    })
    await waitFor(() => expect(mocks.createSshSessionKey).toHaveBeenCalledTimes(2))
  })

  it('opens a new session when the jump host changes', async () => {
    const { rerender } = renderHook(({ host }) => useSftpRemote({ activeHost: host }), {
      initialProps: { host: host({ jumpHostId: 'bastion-a' }) },
    })
    await waitFor(() => expect(mocks.createSshSessionKey).toHaveBeenCalledTimes(1))
    rerender({ host: host({ jumpHostId: 'bastion-b' }) })
    await waitFor(() => expect(mocks.createSshSessionKey).toHaveBeenCalledTimes(2))
  })

  it('still reuses the session when nothing connection-relevant changed', async () => {
    // The other direction: a rename or a colour change must not churn the connection.
    const { rerender } = renderHook(({ host }) => useSftpRemote({ activeHost: host }), {
      initialProps: { host: BASE },
    })
    await waitFor(() => expect(mocks.createSshSessionKey).toHaveBeenCalledTimes(1))
    rerender({ host: host({ name: 'Prod (renamed)', color: '#ff0000' }) })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(
      mocks.createSshSessionKey.mock.calls.length,
      'a cosmetic edit must not reconnect: that would drop an in-flight transfer for nothing',
    ).toBe(1)
  })
})
