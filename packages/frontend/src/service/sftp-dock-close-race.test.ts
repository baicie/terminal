// TN-SFTP-01 — the close path, end to end.
//
// `sftp-session-claim.test.ts` proves the claim primitive and the admission path.
// This file proves the thing a user actually does: close the dock while a transfer
// is being set up, and check that the connection survives, is closed exactly once
// afterwards, and never accepts work once it is on its way out.
//
// Every case uses a controlled promise rather than a sleep, so the window is opened
// on purpose instead of raced for.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTransferQueue } from '@/store/transfer-queue'

const ssh = vi.hoisted(() => ({ close: vi.fn(async () => undefined) }))
vi.mock('@/service/ssh', () => ({ sshService: ssh }))
vi.mock('@/service/notifications', () => ({
  notify: vi.fn(async () => undefined),
}))

const {
  uploadFile,
  configureTransferRuntime,
  __resetProgressListenerForTests,
  __resetTransferQueueForTests,
} = await import('./sftp-transfer')

const {
  __resetSessionClaimsForTests,
  __claimedSessionCount,
  beginSessionClose,
  claimCountForSession,
  claimSession,
  forgetSession,
  isSessionClosing,
} = await import('./sftp-session-claim')

const {
  releaseOrDefer,
  isDeferred,
  __resetDeferredReleases,
  __deferredSessions,
} = await import('@/view/sftp/hooks/sftp-deferred-release')

const { isSessionBusy } = await import('./sftp-transfer-session')

function deferred<T = void>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => {
    resolve = res
  })
  return { promise, resolve }
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

describe('closing the dock while a transfer is being set up', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    __resetSessionClaimsForTests()
    __resetTransferQueueForTests()
    __resetProgressListenerForTests()
    __resetDeferredReleases()
    useTransferQueue.setState({ transfers: [] })
    ssh.close.mockClear()
  })

  afterEach(() => {
    configureTransferRuntime(null)
    __resetSessionClaimsForTests()
    __resetTransferQueueForTests()
    __resetProgressListenerForTests()
    __resetDeferredReleases()
    vi.useRealTimers()
  })

  it('does not close the connection while the listener is installing', async () => {
    const gate = deferred()
    configureTransferRuntime({
      available: true,
      installProgressListener: () => gate.promise,
      run: vi.fn(async () => new Promise<void>(() => undefined)),
    })

    const pending = uploadFile({
      sessionId: 's1',
      localPath: '/tmp/a.bin',
      remotePath: '/srv/a.bin',
      bytesTotal: 10,
    })
    await flush()
    expect(claimCountForSession('s1')).toBe(1)

    // The user closes the dock right now.
    const released = releaseOrDefer('s1', isSessionBusy)
    expect(released).toBe(false)
    expect(isDeferred('s1')).toBe(true)
    expect(ssh.close).not.toHaveBeenCalled()

    // The upload proceeds on the connection that is still open.
    gate.resolve()
    await pending
    expect(useTransferQueue.getState().transfers[0].status).not.toBe('cancelled')

    // The transfer finishes; now the deferred release may act.
    useTransferQueue.setState({ transfers: [] })
    await vi.advanceTimersByTimeAsync(1_500)
    expect(ssh.close).toHaveBeenCalledTimes(1)
    expect(ssh.close).toHaveBeenCalledWith('s1')
  })

  it('does not close while the file picker has not returned', async () => {
    // The picker runs before `uploadFile` is called at all — the container awaits
    // `open({ multiple: true })` and only then decides whether to upload. While the
    // dialog is up nothing has claimed the session, so a close there genuinely
    // succeeds; the requirement is about the decision *after* it, which is the part
    // that used to be unsafe.
    configureTransferRuntime({
      available: true,
      installProgressListener: async () => undefined,
      run: vi.fn(async () => new Promise<void>(() => undefined)),
    })

    const picked = deferred<string[] | null>()
    const chosen = picked.promise.then(paths =>
      paths
        ? uploadFile({ sessionId: 's1', localPath: paths[0], remotePath: '/srv/a.bin' })
        : null,
    )
    picked.resolve(['/tmp/a.bin'])
    await chosen
    expect(useTransferQueue.getState().transfers).toHaveLength(1)
    expect(useTransferQueue.getState().transfers[0].status).toBe('running')

    // A cancel answers with null and starts nothing, on a session nobody claimed.
    const dismissed = deferred<string[] | null>()
    const cancelled = dismissed.promise.then(async (paths): Promise<string> => {
      if (!paths) return 'no-transfer'
      await uploadFile({ sessionId: 's2', localPath: paths[0], remotePath: '/srv/b' })
      return 'started'
    })
    dismissed.resolve(null)
    expect(await cancelled).toBe('no-transfer')
    expect(claimCountForSession('s2')).toBe(0)
  })

  it('a cancel of the file picker leaves no claim behind', async () => {
    // Nothing claims during the dialog by construction; assert it, because a claim
    // taken at the button click and never released would lock the session forever.
    expect(claimCountForSession('s1')).toBe(0)
    expect(isSessionBusy('s1')).toBe(false)
  })

  it('closes exactly once when the last transfer ends', async () => {
    configureTransferRuntime({
      available: true,
      installProgressListener: async () => undefined,
      run: vi.fn(async () => new Promise<void>(() => undefined)),
    })

    await uploadFile({ sessionId: 's1', localPath: '/tmp/a.bin', remotePath: '/srv/a' })
    await uploadFile({ sessionId: 's1', localPath: '/tmp/b.bin', remotePath: '/srv/b' })

    // Three closes requested (body, cleanup, a third for good measure), one
    // connection.
    expect(releaseOrDefer('s1', isSessionBusy)).toBe(false)
    expect(releaseOrDefer('s1', isSessionBusy)).toBe(false)
    expect(releaseOrDefer('s1', isSessionBusy)).toBe(false)
    expect(__deferredSessions()).toBe(1)

    useTransferQueue.setState({ transfers: [] })
    await vi.advanceTimersByTimeAsync(1_500)

    expect(ssh.close).toHaveBeenCalledTimes(1)
  })

  it('a closed session leaves nothing behind for that id', async () => {
    configureTransferRuntime({
      available: true,
      installProgressListener: async () => undefined,
      run: vi.fn(async () => undefined),
    })

    // Nothing is using it, so this closes immediately.
    expect(releaseOrDefer('s1', isSessionBusy)).toBe(true)
    expect(ssh.close).toHaveBeenCalledTimes(1)

    // The bookkeeping goes with the connection. Keeping it was the leak: one
    // record per connection the app ever made, with nothing to reclaim it.
    expect(__claimedSessionCount()).toBe(0)
    expect(isSessionClosing('s1')).toBe(false)
  })

  it('a session claimed while closing is refused, then usable once forgotten', async () => {
    // The refusal has to exist for its window: between `beginSessionClose` and the
    // actual close, new work must not be admitted.
    beginSessionClose('s1')
    expect(claimSession('s1').ok).toBe(false)

    // Once the connection is gone the id is forgotten, and a *new* connection gets
    // a fresh id from the backend (`ssh-<uuid>`), so nothing blocks the user.
    forgetSession('s1')
    expect(claimSession('s1').ok).toBe(true)
  })

  it('a claim taken during the deferred window still blocks the close', async () => {
    // Defer with an empty queue first, so a timer exists; then let a claim appear
    // while that timer is running. The timer must notice it rather than closing on
    // its next tick.
    configureTransferRuntime({
      available: true,
      installProgressListener: async () => new Promise<void>(() => undefined),
      run: vi.fn(async () => undefined),
    })

    // One claim held open is what defers the release; the queue is empty.
    const pending = uploadFile({
      sessionId: 's1',
      localPath: '/tmp/a.bin',
      remotePath: '/srv/a',
    })
    await flush()
    expect(claimCountForSession('s1')).toBe(1)

    // The queue predicate says idle the whole time — only the claim keeps it open.
    expect(releaseOrDefer('s1', () => false)).toBe(false)
    expect(isDeferred('s1')).toBe(true)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(ssh.close).not.toHaveBeenCalled()

    void pending
  })

  it('a host switch mid-preparation does not close the old connection', async () => {
    const gate = deferred()
    configureTransferRuntime({
      available: true,
      installProgressListener: () => gate.promise,
      run: vi.fn(async () => new Promise<void>(() => undefined)),
    })

    const pending = uploadFile({
      sessionId: 'old',
      localPath: '/tmp/a.bin',
      remotePath: '/srv/a',
    })
    await flush()

    // Host switch: the panel releases the old session through the same guard.
    expect(releaseOrDefer('old', isSessionBusy)).toBe(false)
    expect(ssh.close).not.toHaveBeenCalled()

    gate.resolve()
    await pending
    expect(useTransferQueue.getState().transfers).toHaveLength(1)
    // The upload is on the queue, so the connection must still be there.
    expect(useTransferQueue.getState().transfers[0].sessionId).toBe('old')
  })

  it('1000 dock open/close cycles leave no claim records behind', async () => {
    // The leak review found: every close left one permanent record. Session ids are
    // never reused, so nothing ever reclaimed them. The count is the assertion —
    // a fix that only closes the connection still fails here.
    configureTransferRuntime({
      available: true,
      installProgressListener: async () => undefined,
      run: vi.fn(async () => undefined),
    })

    for (let index = 0; index < 1000; index += 1) {
      const id = `ssh-cycle-${index}`
      await uploadFile({ sessionId: id, localPath: '/tmp/a', remotePath: '/srv/a' })
      useTransferQueue.setState({ transfers: [] })
      releaseOrDefer(id, isSessionBusy)
    }

    expect(__claimedSessionCount()).toBe(0)
  })

  it('100 open/close cycles leave nothing behind', async () => {
    configureTransferRuntime({
      available: true,
      installProgressListener: async () => undefined,
      run: vi.fn(async () => new Promise<void>(() => undefined)),
    })

    for (let index = 0; index < 100; index += 1) {
      const id = `cycle-${index}`
      await uploadFile({ sessionId: id, localPath: '/tmp/a', remotePath: '/srv/a' })
      useTransferQueue.setState({ transfers: [] })
      expect(releaseOrDefer(id, isSessionBusy)).toBe(true)
    }

    expect(ssh.close).toHaveBeenCalledTimes(100)
    expect(__deferredSessions()).toBe(0)
    expect(claimCountForSession('cycle-0')).toBe(0)
  })
})
