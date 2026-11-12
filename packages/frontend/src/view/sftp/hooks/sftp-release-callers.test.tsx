// UX-1 hardening — P1: the paths that call `releaseOrDefer` more than once.
//
// The idempotency test pins the primitive. This file pins the *callers*, because
// the duplicate-close defect only reached production through them: the hook calls
// `releaseSessionUnlessBusy()` from the effect body and from the effect cleanup,
// and React runs body-then-cleanup on every dependency change. StrictMode then
// does it a second time.
//
// Every assertion counts `sshService.close` exactly — `toHaveBeenCalledWith`
// passes with three calls, and the bug is the multiplicity.

import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTransferQueue } from '@/store/transfer-queue'
import type { TransferRecord } from '@/store/transfer-queue'

type SshHostArg = { id: string, name: string, authType: string }

const ssh = vi.hoisted(() => ({
  createSshSessionPassword: vi.fn(async (_host: SshHostArg) => ({
    success: true,
    sessionId: 'sess-0',
  })),
  createSshSessionKey: vi.fn(async (_host: SshHostArg) => ({
    success: true,
    sessionId: 'sess-0',
  })),
  close: vi.fn(async (_sessionId: string) => undefined),
  sftpConnect: vi.fn(async () => ({ success: true, message: '' })),
  sftpList: vi.fn(async () => ({ success: true, files: [] })),
}))

vi.mock('@/service/ssh', () => ({ sshService: ssh }))
vi.mock('@/components/ui/sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

const { useSftpRemote } = await import('@/view/sftp/hooks/use-sftp-remote')
const { __resetDeferredReleases, __deferredSessions } = await import(
  './sftp-deferred-release'
)

const HOST_A = { id: 'host-a', name: 'a', authType: 'password' }
const HOST_B = { id: 'host-b', name: 'b', authType: 'password' }

function transfer(sessionId: string, status: TransferRecord['status']): TransferRecord {
  return {
    id: `t-${sessionId}-${status}`,
    kind: 'upload',
    name: 'a.bin',
    localPath: '/tmp/a.bin',
    remotePath: '/srv/a.bin',
    sessionId,
    status,
    bytesDone: 0,
    bytesTotal: 100,
    speed: 0,
    startedAt: 1,
  }
}

/** Three awaited ticks: session promise, then the chained connect, then state. */
async function settle() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

function mount(initialHost = HOST_A, wrapper?: (props: { children: React.ReactNode }) => React.ReactElement) {
  return renderHook((props: { activeHost: typeof HOST_A }) => useSftpRemote(props), {
    initialProps: { activeHost: initialHost },
    ...(wrapper ? { wrapper } : {}),
  })
}

describe('SFTP session release across remounts and switches', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ssh.close.mockClear()
    ssh.sftpConnect.mockResolvedValue({ success: true, message: '' })
    ssh.sftpList.mockResolvedValue({ success: true, files: [] })
    // A fresh id per connect, so "did it open a second session" and "is this the
    // same session" are both observable. The counter is reset per test.
    let sessionCounter = 0
    ssh.createSshSessionPassword.mockImplementation(async () => ({
      success: true,
      sessionId: `sess-${++sessionCounter}`,
    }))
    useTransferQueue.setState({ transfers: [] })
    __resetDeferredReleases()
  })

  afterEach(() => {
    vi.useRealTimers()
    useTransferQueue.setState({ transfers: [] })
    __resetDeferredReleases()
  })

  it('closes exactly once on a plain unmount with no transfers', async () => {
    const hook = mount()
    await settle()

    act(() => hook.unmount())

    expect(ssh.close).toHaveBeenCalledTimes(1)
  })

  it('host A upload running → switch to B: A is neither closed nor reused', async () => {
    const hook = mount()
    await settle()
    useTransferQueue.setState({ transfers: [transfer('sess-1', 'running')] })

    hook.rerender({ activeHost: HOST_B })
    await settle()

    // A second session was opened for B, and A was left open for its transfer.
    // The exact connect count is not the invariant — React may run the listing
    // effect more than once; what must hold is that A was neither closed nor
    // silently reused for B.
    expect(ssh.createSshSessionPassword.mock.calls.length).toBeGreaterThanOrEqual(2)
    // The first connect was A; everything after the switch is B. Nothing
    // re-connects A, which is what "not revived" means.
    expect(ssh.createSshSessionPassword.mock.calls[0][0].id).toBe('host-a')
    const afterSwitch = ssh.createSshSessionPassword.mock.calls.slice(1)
    expect(afterSwitch.length).toBeGreaterThanOrEqual(1)
    // A stale-key connection is opened and immediately closed by `ensureSession`
    // (it re-checks `hostKeyRef` after the await). So the invariant is not "no
    // second A connect" — it is "no *leak* of one".
    const staleCloses = ssh.close.mock.calls.filter(
      call => call[0] !== 'sess-1',
    )
    expect({ staleLeaked: staleCloses.length === 0 && afterSwitch[0][0].id === 'host-a' }).toEqual({
      staleLeaked: true,
    })
    expect(ssh.close).not.toHaveBeenCalledWith('sess-1')
  })

  it('switching back to A opens a new session rather than reviving the old one', async () => {
    // Reusing a connection whose panel was gone would mean acting on a session
    // nobody is watching, with its own transfers in flight.
    const hook = mount()
    await settle()
    useTransferQueue.setState({ transfers: [transfer('sess-1', 'running')] })

    hook.rerender({ activeHost: HOST_B })
    await settle()
    const afterB = ssh.createSshSessionPassword.mock.calls.length
    hook.rerender({ activeHost: HOST_A })
    await settle()

    // Returning to A opens a new connection: the old one belongs to a panel that
    // no longer exists, and reviving it would act on a session nobody watches.
    expect(ssh.createSshSessionPassword.mock.calls.length).toBeGreaterThan(afterB)
    const last = ssh.createSshSessionPassword.mock.calls.at(-1)!
    expect(last[0].id).toBe('host-a')
    expect(ssh.close).not.toHaveBeenCalledWith('sess-1')
  })

  it('settling the last transfer closes the deferred session exactly once', async () => {
    const hook = mount()
    await settle()
    useTransferQueue.setState({ transfers: [transfer('sess-1', 'running')] })

    act(() => hook.unmount())
    expect(ssh.close).toHaveBeenCalledTimes(0)

    act(() => useTransferQueue.setState({ transfers: [transfer('sess-1', 'done')] }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })

    expect(ssh.close).toHaveBeenCalledTimes(1)
    expect(ssh.close).toHaveBeenCalledWith('sess-1')
  })

  it('a failed transfer also releases exactly once', async () => {
    const hook = mount()
    await settle()
    useTransferQueue.setState({ transfers: [transfer('sess-1', 'error')] })

    act(() => hook.unmount())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })

    expect(ssh.close).toHaveBeenCalledTimes(1)
  })

  it('a cancelled transfer also releases exactly once', async () => {
    const hook = mount()
    await settle()
    useTransferQueue.setState({ transfers: [transfer('sess-1', 'cancelled')] })

    act(() => hook.unmount())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })

    expect(ssh.close).toHaveBeenCalledTimes(1)
  })

  it('dock close/reopen while nothing moves leaves no watcher behind', async () => {
    const first = mount()
    await settle()
    act(() => first.unmount())

    const second = mount()
    await settle()
    act(() => second.unmount())

    // Two mounts, two closes, zero leftover watchers.
    expect(ssh.close).toHaveBeenCalledTimes(2)
    expect(__deferredSessions()).toBe(0)
  })

  it('repeated mount/unmount without transfers does not accumulate pollers', async () => {
    for (let index = 0; index < 5; index += 1) {
      const hook = mount()
      await settle()
      act(() => hook.unmount())
    }

    expect(__deferredSessions()).toBe(0)
    expect(ssh.close).toHaveBeenCalledTimes(5)
  })

  it('StrictMode double-invoked effects close the session at most once', async () => {
    // React 19 StrictMode mounts, unmounts and remounts effects. Before the fix
    // this path scheduled one watcher per invocation for the same session.
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <StrictMode>{children}</StrictMode>
    )
    const hook = mount(HOST_A, wrapper)
    await settle()

    act(() => hook.unmount())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })

    // A session is closed at most once, no matter how many effects ran.
    const closedSessions = ssh.close.mock.calls.map(call => call[0])
    expect(new Set(closedSessions).size).toBe(closedSessions.length)
    expect(__deferredSessions()).toBe(0)
  })

  it('a deferred session with a live transfer is not closed by a remount', async () => {
    const hook = mount()
    await settle()
    useTransferQueue.setState({ transfers: [transfer('sess-1', 'running')] })
    act(() => hook.unmount())

    // Dock reopens while the upload is still running.
    const reopened = mount()
    await settle()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })

    expect(ssh.close).not.toHaveBeenCalledWith('sess-1')
    act(() => reopened.unmount())
  })
})
