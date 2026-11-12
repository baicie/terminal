// UX-1 hardening — P1: deferred release must be idempotent per session.
//
// The defect this file pins down: `deferredReleases` is a `Set<string>`. It
// records *that* a session is deferred, never *which timer* is watching it. So:
//
//     releaseOrDefer('s1', busy)   // schedules interval #1
//     releaseOrDefer('s1', busy)   // schedules interval #2
//     releaseOrDefer('s1', busy)   // schedules interval #3
//
// and when the transfer settles, all three fire `close('s1')` in the same tick.
//
// Is that reachable? Yes, and by design of the code around it: the hook calls
// `releaseSessionUnlessBusy()` from the effect body (before a host switch) and
// from the effect cleanup (on unmount). React runs body-then-cleanup on every
// dependency change, and StrictMode double-invokes effects. A remount of the dock
// on the same session adds more calls.
//
// Every assertion below counts `close` calls exactly. `toHaveBeenCalledWith`
// would pass with three calls; the bug is the multiplicity.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ssh = vi.hoisted(() => ({ close: vi.fn(async () => undefined) }))

vi.mock('@/service/ssh', () => ({ sshService: ssh }))

const { releaseOrDefer, isDeferred, __resetDeferredReleases, __deferredSessions } =
  await import('./sftp-deferred-release')

describe('releaseOrDefer is idempotent per session', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ssh.close.mockClear()
    __resetDeferredReleases()
  })

  afterEach(() => {
    vi.useRealTimers()
    __resetDeferredReleases()
  })

  it('closes exactly once after three calls while busy', async () => {
    let busy = true
    const isBusy = () => busy

    expect(releaseOrDefer('s1', isBusy)).toBe(false)
    expect(releaseOrDefer('s1', isBusy)).toBe(false)
    expect(releaseOrDefer('s1', isBusy)).toBe(false)

    expect(isDeferred('s1')).toBe(true)
    expect(ssh.close).not.toHaveBeenCalled()

    busy = false
    await vi.advanceTimersByTimeAsync(1_500)

    // The defect: three intervals, three closes, three `close` IPC calls for one
    // connection. The second and third succeed trivially (the backend reports an
    // unknown session) but they still cross the boundary.
    expect(ssh.close).toHaveBeenCalledTimes(1)
    expect(ssh.close).toHaveBeenCalledWith('s1')
    expect(isDeferred('s1')).toBe(false)
  })

  it('never closes while a transfer is running', async () => {
    const isBusy = () => true

    releaseOrDefer('s1', isBusy)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(ssh.close).not.toHaveBeenCalled()
  })

  it('never closes while a transfer is queued', async () => {
    // `queued` counts as busy: it has not opened its bytes yet, but it will, and
    // closing underneath it fails it for a reason the user did not cause.
    const isBusy = () => true
    releaseOrDefer('s1', isBusy)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(ssh.close).not.toHaveBeenCalled()
  })

  it('closes exactly once when the transfer finishes', async () => {
    let busy = true
    releaseOrDefer('s1', () => busy)
    busy = false
    await vi.advanceTimersByTimeAsync(1_500)
    expect(ssh.close).toHaveBeenCalledTimes(1)
  })

  it('closes exactly once when the transfer fails', async () => {
    let busy = true
    releaseOrDefer('s1', () => busy)
    busy = false // `error` and `cancelled` are both terminal
    await vi.advanceTimersByTimeAsync(1_500)
    expect(ssh.close).toHaveBeenCalledTimes(1)
  })

  it('closes immediately when nothing is busy, and only once', () => {
    expect(releaseOrDefer('s1', () => false)).toBe(true)
    expect(releaseOrDefer('s1', () => false)).toBe(true)

    // Two immediate releases of an already-closed session are the caller's
    // business: the first call reports `true` (forget it). The second call is
    // asking about a session the caller should no longer hold, so a second close
    // here is the caller's bug, not this function's. What must hold is that a
    // *deferred* session is closed once — asserted above.
    expect(ssh.close).toHaveBeenCalledTimes(2)
  })

  it('keeps two different sessions independent', async () => {
    let busyA = true
    let busyB = true
    releaseOrDefer('a', () => busyA)
    releaseOrDefer('b', () => busyB)

    busyA = false
    await vi.advanceTimersByTimeAsync(1_500)
    expect(ssh.close).toHaveBeenCalledTimes(1)
    expect(ssh.close).toHaveBeenCalledWith('a')

    busyB = false
    await vi.advanceTimersByTimeAsync(1_500)
    expect(ssh.close).toHaveBeenCalledTimes(2)
    expect(ssh.close).toHaveBeenLastCalledWith('b')
  })

  it('can defer a session again after it was released', async () => {
    // A reconnect gets a new session id in practice, but the guard must not be
    // permanently poisoned by a previous release of the same id.
    let busy = true
    releaseOrDefer('s1', () => busy)
    busy = false
    await vi.advanceTimersByTimeAsync(1_500)
    expect(ssh.close).toHaveBeenCalledTimes(1)

    busy = true
    releaseOrDefer('s1', () => busy)
    busy = false
    await vi.advanceTimersByTimeAsync(1_500)
    expect(ssh.close).toHaveBeenCalledTimes(2)
  })

  it('reports how many sessions are deferred', () => {
    // A cheap structural probe: a leak shows up as a count that never returns to
    // zero, which is the "unbounded poller" failure the task forbids.
    releaseOrDefer('a', () => true)
    releaseOrDefer('a', () => true)
    expect(__deferredSessions()).toBe(1)
  })
})
