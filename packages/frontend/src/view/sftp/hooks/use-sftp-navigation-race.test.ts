// The last directory the user asked for is the one that must be shown.
//
// ## The race
//
// `loadDir` guards against a *host* change (`generationRef`, `hostKeyRef`) but not
// against a newer *navigation* within the same host. Two listings on the same session
// carry the same generation and the same key, so whichever resolves last wins — and a
// slow `/a` started before a fast `/b` resolves after it and puts `/a` back on screen.
//
// The user sees the directory they navigated away from, with no indication anything
// went wrong.

import { act, renderHook, waitFor } from '@testing-library/react'
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

const HOST = {
  id: 'h-1', name: 'E2E Local', hostname: '127.0.0.1', port: 2222,
  username: 'u', authType: 'key',
} as never

function file(name: string) {
  return { name, path: `/${name}`, size: 1, is_directory: false, modified: 0, permissions: '' }
}

/** A promise the test resolves by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createSshSessionKey.mockResolvedValue({ success: true, sessionId: 'sess-1' })
  mocks.sftpConnect.mockResolvedValue({ success: true })
  mocks.sftpResolvePath.mockImplementation(async (_sid: string, p: string) => p)
  mocks.sftpRelease.mockResolvedValue(undefined)
  mocks.close.mockResolvedValue(undefined)
  mocks.sftpList.mockResolvedValue({ success: true, files: [] })
})

describe('two navigations on the same host', () => {
  it('shows the last requested directory, not the last to resolve', async () => {
    const slowA = deferred<{ success: boolean, files: ReturnType<typeof file>[] }>()
    mocks.sftpList.mockImplementation(async (_sid: string, path: string) => {
      if (path === '/a') return slowA.promise
      if (path === '/b') return { success: true, files: [file('b.txt')] }
      return { success: true, files: [] }
    })

    const { result } = renderHook(() => useSftpRemote({ activeHost: HOST }))
    await waitFor(() => expect(result.current.sessionId).toBe('sess-1'))

    act(() => {
      void result.current.navigate('/a')
    })
    act(() => {
      void result.current.navigate('/b')
    })
    // `/b` lands first.
    await waitFor(() => expect(result.current.path).toBe('/b'))
    expect(result.current.files.map(f => f.name)).toEqual(['b.txt'])

    // `/a` now answers, describing a directory the user has left.
    await act(async () => {
      slowA.resolve({ success: true, files: [file('a.txt')] })
      await Promise.resolve()
    })

    expect(
      result.current.path,
      'a slow listing must not move the user back to a directory they left',
    ).toBe('/b')
    expect(result.current.files.map(f => f.name)).toEqual(['b.txt'])
  })

  it('does not leave loading stuck when a superseded listing fails', async () => {
    const slowA = deferred<{ success: boolean, files: ReturnType<typeof file>[] }>()
    mocks.sftpList.mockImplementation(async (_sid: string, path: string) => {
      if (path === '/a') return slowA.promise
      return { success: true, files: [file('b.txt')] }
    })

    const { result } = renderHook(() => useSftpRemote({ activeHost: HOST }))
    await waitFor(() => expect(result.current.sessionId).toBe('sess-1'))

    act(() => {
      void result.current.navigate('/a')
    })
    act(() => {
      void result.current.navigate('/b')
    })
    await waitFor(() => expect(result.current.path).toBe('/b'))

    await act(async () => {
      slowA.resolve({ success: false, files: [] } as never)
      await Promise.resolve()
    })
    expect(result.current.loading, 'the newest listing already finished').toBe(false)
    expect(result.current.files.map(f => f.name)).toEqual(['b.txt'])
  })
})

describe('the other ways a stale listing can arrive', () => {
  it('a failed navigation does not overwrite a directory the user moved to', async () => {
    const failing = deferred<{ success: boolean, files: ReturnType<typeof file>[], message?: string }>()
    mocks.sftpList.mockImplementation(async (_sid: string, path: string) => {
      if (path === '/broken') return failing.promise
      return { success: true, files: [file('ok.txt')] }
    })

    const { result } = renderHook(() => useSftpRemote({ activeHost: HOST }))
    await waitFor(() => expect(result.current.sessionId).toBe('sess-1'))

    act(() => {
      void result.current.navigate('/broken')
    })
    act(() => {
      void result.current.navigate('/fine')
    })
    await waitFor(() => expect(result.current.path).toBe('/fine'))

    await act(async () => {
      failing.resolve({ success: false, files: [], message: 'no such directory' })
      await Promise.resolve()
    })
    expect(result.current.path).toBe('/fine')
    expect(result.current.files.map(f => f.name)).toEqual(['ok.txt'])
  })

  it('unmounting while a listing is in flight does not warn or write state', async () => {
    const slow = deferred<{ success: boolean, files: ReturnType<typeof file>[] }>()
    mocks.sftpList.mockImplementation(async (_sid: string, path: string) =>
      path === '/slow' ? slow.promise : { success: true, files: [] },
    )
    const { result, unmount } = renderHook(() => useSftpRemote({ activeHost: HOST }))
    await waitFor(() => expect(result.current.sessionId).toBe('sess-1'))

    act(() => {
      void result.current.navigate('/slow')
    })
    unmount()
    await act(async () => {
      slow.resolve({ success: true, files: [file('late.txt')] })
      await Promise.resolve()
    })
    // Reaching here without a React state-update warning is the assertion; the
    // environment fails the test on `console.error` from an unmounted update.
    expect(true).toBe(true)
  })
})
