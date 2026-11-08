import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FileItem } from '@/service/ssh'
import { useSftpRemote } from './use-sftp-remote'

const mocks = vi.hoisted(() => ({
  close: vi.fn(async () => undefined),
  createSshSessionPassword: vi.fn(),
  sftpConnect: vi.fn(),
  sftpList: vi.fn(),
  sftpDelete: vi.fn(),
  sftpRename: vi.fn(),
  sftpMkdir: vi.fn(),
}))

vi.mock('@/service/ssh', () => ({ sshService: mocks }))
vi.mock('@/components/ui/sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

const HOST_A = { id: 'host-a', name: 'A', authType: 'password' }
const HOST_B = { id: 'host-b', name: 'B', authType: 'password' }

function file(name: string): FileItem {
  return {
    name,
    path: `/${name}`,
    size: 1,
    is_directory: false,
    modified: 0,
    permissions: '',
  } as unknown as FileItem
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

describe('useSftpRemote host isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createSshSessionPassword.mockImplementation(async (host: { id: string }) => ({
      success: true,
      sessionId: host.id === 'host-a' ? 'sess-a' : 'sess-b',
    }))
    mocks.sftpConnect.mockResolvedValue({ success: true })
    mocks.sftpDelete.mockResolvedValue({ success: true })
    mocks.sftpRename.mockResolvedValue({ success: true })
    mocks.sftpMkdir.mockResolvedValue({ success: true })
  })

  it('never lets a slow response from the previous host reach the next host', async () => {
    const slowA = deferred<{ success: boolean, files: FileItem[] }>()
    mocks.sftpList.mockImplementation(async (sessionId: string, path: string) => {
      if (sessionId === 'sess-a' && path === '/slow') return slowA.promise
      if (sessionId === 'sess-b') return { success: true, files: [file('b.txt')] }
      return { success: true, files: [file('a.txt')] }
    })

    const { result, rerender } = renderHook(
      ({ host }) => useSftpRemote({ activeHost: host }),
      { initialProps: { host: HOST_A } },
    )
    await waitFor(() => expect(result.current.sessionId).toBe('sess-a'))
    const callsBeforeSlow = mocks.sftpList.mock.calls.length

    act(() => {
      void result.current.loadDir('/slow')
    })
    // The host changes while A's listing is still in flight.
    rerender({ host: HOST_B })

    await waitFor(() => expect(result.current.files.map(item => item.name)).toEqual(['b.txt']))
    // The in-flight '/slow' call belongs to A and was started before the
    // switch; any listing of the new host's root must use B's session.
    const rootCallsAfterSlow = mocks.sftpList.mock.calls
      .slice(callsBeforeSlow)
      .filter(call => call[1] === '/')
    expect(rootCallsAfterSlow.every(call => call[0] === 'sess-b')).toBe(true)

    await act(async () => {
      slowA.resolve({ success: true, files: [file('a-secret.txt')] })
      await slowA.promise
    })

    expect(result.current.files.map(item => item.name)).toEqual(['b.txt'])
    expect(mocks.close).toHaveBeenCalledWith('sess-a')
  })

  it('opens one session when two loads race before the connection resolves', async () => {
    const slowCreate = deferred<{ success: boolean, sessionId: string }>()
    mocks.createSshSessionPassword.mockReturnValue(slowCreate.promise)
    mocks.sftpList.mockResolvedValue({ success: true, files: [] })

    const { result } = renderHook(
      ({ host }) => useSftpRemote({ activeHost: host }),
      { initialProps: { host: HOST_A } },
    )
    act(() => {
      void result.current.loadDir('/one')
      void result.current.loadDir('/two')
    })
    await act(async () => {
      slowCreate.resolve({ success: true, sessionId: 'sess-a' })
    })

    await waitFor(() => expect(result.current.sessionId).toBe('sess-a'))
    expect(mocks.createSshSessionPassword).toHaveBeenCalledTimes(1)
  })

  it('closes a session that resolves after the view unmounted', async () => {
    const slowCreate = deferred<{ success: boolean, sessionId: string }>()
    mocks.createSshSessionPassword.mockReturnValue(slowCreate.promise)
    mocks.sftpList.mockResolvedValue({ success: true, files: [] })

    const { unmount } = renderHook(() => useSftpRemote({ activeHost: HOST_A }))
    unmount()
    await act(async () => {
      slowCreate.resolve({ success: true, sessionId: 'sess-a' })
    })

    await waitFor(() => expect(mocks.close).toHaveBeenCalledWith('sess-a'))
  })

  it('sends file operations only to the session of the current host', async () => {
    mocks.sftpList.mockResolvedValue({ success: true, files: [file('b.txt')] })
    const { result, rerender } = renderHook(
      ({ host }) => useSftpRemote({ activeHost: host }),
      { initialProps: { host: HOST_A } },
    )
    await waitFor(() => expect(result.current.sessionId).toBe('sess-a'))
    rerender({ host: HOST_B })
    await waitFor(() => expect(result.current.sessionId).toBe('sess-b'))

    await act(async () => {
      await result.current.deleteFile(file('b.txt'))
      await result.current.renameFile(file('b.txt'), 'c.txt')
      await result.current.mkdir('dir')
    })

    expect(mocks.sftpDelete).toHaveBeenCalledWith('sess-b', '/b.txt', false)
    expect(mocks.sftpRename).toHaveBeenCalledWith('sess-b', '/b.txt', '/c.txt')
    expect(mocks.sftpMkdir).toHaveBeenCalledWith('sess-b', '/dir')
    expect(mocks.sftpDelete).not.toHaveBeenCalledWith('sess-a', expect.anything(), expect.anything())
  })
})
