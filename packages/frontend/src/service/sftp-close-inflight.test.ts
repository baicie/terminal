// Issue #51 — the close is asynchronous, so the closing state must outlive the call.
//
// ## The race
//
// `releaseOrDefer` used to do this on both the immediate and the deferred path:
//
//     void sshService.close(sessionId).catch(() => undefined)
//     forgetSession(sessionId)
//
// `sshService.close` → `SessionService.close` → `await invoke('session_close')`, an
// IPC round trip. `forgetSession` runs **synchronously**, so the closing marker is
// gone before the backend has confirmed anything. A late `uploadFile()` in that
// window calls `claimSession(sessionId)`, finds no record, and is admitted — then
// the in-flight `session_close` tears the connection down under it.
//
// ## What these tests pin
//
// The tests hold `sshService.close` open with a controlled promise, which makes the
// window explicit instead of raced for. The invariant is:
//
//   * while a close is in flight, the id refuses new claims;
//   * once it resolves, the id **still** refuses (the connection is gone for good);
//   * if it *rejects*, the id must not silently become claimable again — that would
//     reopen a connection the backend may already have dropped.
//
// The last one is a judgement call and it is deliberate: session ids are generated
// per connection (`ssh-<uuid>`), so there is no scenario where reusing the id is
// correct. Refusing forever costs one record; admitting a transfer onto a possibly
// dead connection costs the user's upload.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTransferQueue } from '@/store/transfer-queue'

const ssh = vi.hoisted(() => ({ close: vi.fn<(id: string) => Promise<void>>() }))
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
  claimCountForSession,
  claimSession,
  isSessionClosing,
  registerSession,
} = await import('./sftp-session-claim')

const {
  releaseOrDefer,
  __resetDeferredReleases,
} = await import('@/view/sftp/hooks/sftp-deferred-release')

const { isSessionBusy } = await import('./sftp-transfer-session')

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

describe('a session being closed refuses claims until the close settles', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    __resetSessionClaimsForTests()
    __resetTransferQueueForTests()
    __resetProgressListenerForTests()
    __resetDeferredReleases()
    useTransferQueue.setState({ transfers: [] })
    ssh.close.mockClear()
    ssh.close.mockImplementation(async () => undefined)
    // The claim module is an allowlist; a session that was never registered is
    // refused as `unknown` before any of these cases get to the interesting part.
    registerSession('s1')
  })

  afterEach(() => {
    configureTransferRuntime(null)
    __resetSessionClaimsForTests()
    __resetTransferQueueForTests()
    __resetProgressListenerForTests()
    __resetDeferredReleases()
    vi.useRealTimers()
  })

  it('immediate close: refuses a claim while the IPC is still in flight', async () => {
    const close = deferred<void>()
    ssh.close.mockImplementation(() => close.promise)

    // Nothing is using the session, so this takes the immediate path.
    expect(releaseOrDefer('s1', isSessionBusy)).toBe(true)
    expect(ssh.close).toHaveBeenCalledTimes(1)

    // The backend has not confirmed yet.
    expect(isSessionClosing('s1')).toBe(true)
    expect(claimSession('s1').ok).toBe(false)

    // A late transfer must be refused *visibly*, not silently dropped.
    configureTransferRuntime({
      available: true,
      installProgressListener: async () => undefined,
      run: vi.fn(async () => undefined),
    })
    await uploadFile({ sessionId: 's1', localPath: '/tmp/a', remotePath: '/srv/a' })
    const transfers = useTransferQueue.getState().transfers
    expect(transfers).toHaveLength(1)
    expect(transfers[0].status).toBe('error')
    expect(transfers[0].message).toContain('closing')

    close.resolve()
    await flush()
  })

  it('immediate close: still refuses after the IPC resolves', async () => {
    const close = deferred<void>()
    ssh.close.mockImplementation(() => close.promise)

    releaseOrDefer('s1', isSessionBusy)
    close.resolve()
    await flush()

    // The connection is gone. The id must not come back to life.
    expect(claimSession('s1').ok).toBe(false)
  })

  it('deferred close: refuses a claim while the watcher close is in flight', async () => {
    const close = deferred<void>()
    ssh.close.mockImplementation(() => close.promise)
    configureTransferRuntime({
      available: true,
      installProgressListener: async () => undefined,
      run: vi.fn(async () => new Promise<void>(() => undefined)),
    })

    // One live transfer keeps the release deferred.
    await uploadFile({ sessionId: 's1', localPath: '/tmp/a', remotePath: '/srv/a' })
    expect(releaseOrDefer('s1', isSessionBusy)).toBe(false)

    // The transfer settles; the watcher fires on its next tick.
    useTransferQueue.setState({ transfers: [] })
    await vi.advanceTimersByTimeAsync(1_500)
    expect(ssh.close).toHaveBeenCalledTimes(1)

    // Now the close is in flight. This is the window the issue describes.
    expect(claimSession('s1').ok).toBe(false)

    close.resolve()
    await flush()
    // And after it settles.
    expect(claimSession('s1').ok).toBe(false)
  })

  it('a rejected close does not silently reopen the id', async () => {
    const close = deferred<void>()
    ssh.close.mockImplementation(() => close.promise)

    releaseOrDefer('s1', isSessionBusy)
    close.reject(new Error('backend unavailable'))
    await flush()

    // The backend may or may not have closed it. Admitting a transfer onto that
    // connection is the failure the whole module exists to prevent, so the id
    // stays refused; a new connection gets a new `ssh-<uuid>` anyway.
    expect(claimSession('s1').ok).toBe(false)
    expect(isSessionClosing('s1')).toBe(true)
  })

  it('a late release for a forgotten id is a safe no-op', async () => {
    const claim = claimSession('s1')
    if (!claim.ok) throw new Error('claim should be granted')
    expect(claimCountForSession('s1')).toBe(1)

    // Whatever removes the record, a release arriving afterwards must not throw
    // and must not recreate anything.
    const close = deferred<void>()
    ssh.close.mockImplementation(() => close.promise)
    releaseOrDefer('s1', isSessionBusy)
    close.resolve()
    await flush()

    expect(() => claim.release()).not.toThrow()
    // Releasing must not clear the closing marker either — that would admit work
    // onto a closed connection.
    expect(claimSession('s1').ok).toBe(false)
  })

  it('1000 connect/close cycles keep the registry bounded', async () => {
    configureTransferRuntime({
      available: true,
      installProgressListener: async () => undefined,
      run: vi.fn(async () => undefined),
    })
    ssh.close.mockImplementation(async () => undefined)

    for (let index = 0; index < 1000; index += 1) {
      const id = `ssh-cycle-${index}`
      registerSession(id)
      await uploadFile({ sessionId: id, localPath: '/tmp/a', remotePath: '/srv/a' })
      useTransferQueue.setState({ transfers: [] })
      releaseOrDefer(id, isSessionBusy)
    }
    await flush()

    // Bounded, but not by forgetting that these ids are dead: see the module note.
    // What must not grow is *live* bookkeeping — records whose close never settled.
    const { __liveSessionCount } = await import('./sftp-session-claim')
    expect(__liveSessionCount()).toBe(0)
  })
})
