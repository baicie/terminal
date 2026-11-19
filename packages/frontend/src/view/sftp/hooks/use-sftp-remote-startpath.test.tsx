// The dock must open where the server puts the user, not at `/`.
//
// ## The defect this pins
//
// The hook loaded `/` on every host change. Against the E2E sshd that listing came
// back empty while the session's home was full: the dock rendered "Empty directory"
// to a user whose home directory has files in it.
//
// The proxy assertion is the requested path. `.` is the only value that asks the
// server to resolve the session's own directory, so "the first listing asks for `.`"
// is the checkable form of "the dock opens on home".

import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sftpList: vi.fn(),
  sftpConnect: vi.fn(),
  sftpRelease: vi.fn(),
  sftpResolvePath: vi.fn(),
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
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const { useSftpRemote } = await import('./use-sftp-remote')

const host = {
  id: 'h-1',
  name: 'E2E Local',
  hostname: '127.0.0.1',
  port: 2222,
  username: 'u',
  authType: 'key',
} as never

beforeEach(() => {
  mocks.createSshSessionKey.mockReset().mockResolvedValue({ success: true, sessionId: 'ssh-1' })
  mocks.createSshSessionPassword.mockReset().mockResolvedValue({ success: true, sessionId: 'ssh-1' })
  mocks.close.mockReset().mockResolvedValue(undefined)
  mocks.sftpConnect.mockReset().mockResolvedValue({ success: true })
  mocks.sftpList.mockReset().mockResolvedValue({ success: true, files: [] })
  mocks.sftpRelease.mockReset().mockResolvedValue(undefined)
  mocks.sftpResolvePath.mockReset().mockResolvedValue('/home/u')
})

describe('the first listing', () => {
  it('asks the server where the session starts, then lists there', async () => {
    renderHook(() => useSftpRemote({ activeHost: host }))
    await waitFor(() => expect(mocks.sftpList).toHaveBeenCalled())
    expect(
      mocks.sftpResolvePath.mock.calls[0]?.[1],
      'the dock must ask the server for its own directory, not assume the root',
    ).toBe('.')
    expect(
      mocks.sftpList.mock.calls[0][1],
      'and then list the resolved directory — every path it builds later is absolute',
    ).toBe('/home/u')
  })
})
