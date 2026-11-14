// TN-SFTP-01 — the session claim, and the window it closes.
//
// `uploadFile()` / `downloadFile()` used to `await prepareChannel(args)` — an IPC
// round trip — before `scheduleTransfer(args)`. During that await the transfer was
// in **no** queue, so `hasTransfersForSession()` answered "idle", and a dock closing
// in that window closed the connection the upload was about to use.
//
// The file picker makes the window bigger, not smaller: `handleUpload` opens a
// native dialog first, and the user can leave it open indefinitely. Nothing in the
// queue exists until they answer.
//
// ## Issue #73 — the allowlist this file now pins
//
// The first version of this module claimed to be an allowlist and was not: it kept
// a `closed` set and admitted anything not in it, so an id that had **never been
// registered** was granted a claim. It also capped that set at 4096 entries with
// oldest-first eviction, so after 4096 closes the oldest ids fell out and became
// claimable again. And `completeSessionClose` removed nothing, so "closing" and
// "closed" were the same state.
//
// Every claim test below therefore calls `registerSession` first. That is the
// contract: liveness comes from `registerSession` and from nowhere else. The cases
// that read as if they were about a missing registration are the ones that assert
// the refusal.
//
// These tests drive the real `uploadFile` / `downloadFile` with a controlled
// `installProgressListener` promise, so the window is opened deliberately rather
// than raced for.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTransferQueue } from '@/store/transfer-queue'

const ssh = vi.hoisted(() => ({ close: vi.fn(async () => undefined) }))
vi.mock('@/service/ssh', () => ({ sshService: ssh }))
vi.mock('@/service/notifications', () => ({
  notify: vi.fn(async () => undefined),
}))

const {
  uploadFile,
  downloadFile,
  uploadPaths,
  configureTransferRuntime,
  __resetProgressListenerForTests,
  __resetTransferQueueForTests,
} = await import('./sftp-transfer')

const {
  claimSession,
  hasClaimsForSession,
  claimCountForSession,
  beginSessionClose,
  completeSessionClose,
  forgetSession,
  registerSession,
  isSessionActive,
  isSessionClosing,
  __resetSessionClaimsForTests,
  __trackedSessionCount,
  __claimedSessionCount,
} = await import('./sftp-session-claim')

const { hasTransfersForSession, isSessionIdle, isSessionBusy } = await import(
  './sftp-transfer-session'
)

/** A promise plus the handles needed to settle it from a test. */
function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Let every pending microtask run. */
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/** A claim that the test asserts was granted, without re-checking at each use. */
function grant(sessionId: string) {
  const claim = claimSession(sessionId)
  if (!claim.ok) throw new Error(`claim on ${sessionId} should be granted`)
  return claim
}

describe('session claims', () => {
  beforeEach(() => {
    __resetSessionClaimsForTests()
    __resetTransferQueueForTests()
    // The listener promise is memoized across calls (that is what makes it
    // idempotent), so without this a test that installed one successfully would
    // hand the next test a resolved promise and skip the gate it set up.
    __resetProgressListenerForTests()
    useTransferQueue.setState({ transfers: [] })
    ssh.close.mockClear()
  })

  afterEach(() => {
    configureTransferRuntime(null)
    __resetSessionClaimsForTests()
    __resetTransferQueueForTests()
    __resetProgressListenerForTests()
  })

  describe('the allowlist', () => {
    it('refuses an id that was never registered', () => {
      // The defect #73 reports: this used to be granted, because "not closing"
      // was the only question asked and an unknown id is not closing.
      const claim = claimSession('never-registered')
      expect(claim.ok).toBe(false)
      if (claim.ok) throw new Error('unreachable')
      expect(claim.reason).toBe('unknown')
      expect(hasClaimsForSession('never-registered')).toBe(false)
    })

    it('refuses an unknown id after a close was requested for it', () => {
      // `beginSessionClose` records a closing entry even for an id it has never
      // seen, so a close request in flight still refuses stragglers. The reason
      // changes from `unknown` to `closing` — both refuse, which is what matters.
      expect(beginSessionClose('never-registered')).toBe(true)
      const claim = claimSession('never-registered')
      expect(claim.ok).toBe(false)
      if (claim.ok) throw new Error('unreachable')
      expect(claim.reason).toBe('closing')
    })

    it('grants a claim once the id is registered', () => {
      registerSession('s1')
      const claim = claimSession('s1')
      expect(claim.ok).toBe(true)
      expect(hasClaimsForSession('s1')).toBe(true)
      expect(isSessionActive('s1')).toBe(true)
    })

    it('is synchronous — a claim taken before any await is visible immediately', () => {
      registerSession('s1')
      const claim = grant('s1')
      expect(hasClaimsForSession('s1')).toBe(true)
      claim.release()
    })

    it('reports liveness only for registered, non-closing ids', () => {
      // The three states, asked of one function. `unknown` must not read as
      // active — that is the exact confusion #73 describes.
      expect(isSessionActive('nothing')).toBe(false)
      registerSession('live')
      expect(isSessionActive('live')).toBe(true)
      beginSessionClose('live')
      expect(isSessionActive('live')).toBe(false)
      expect(isSessionClosing('live')).toBe(true)
      completeSessionClose('live')
      expect(isSessionActive('live')).toBe(false)
      expect(isSessionClosing('live')).toBe(false)
    })
  })

  describe('claim primitives', () => {
    beforeEach(() => registerSession('s1'))

    it('allows several concurrent claims on one session', () => {
      // `uploadPaths` starts every file in parallel; they all prepare on the same
      // connection.
      const a = claimSession('s1')
      const b = claimSession('s1')
      const c = claimSession('s1')
      expect([a.ok, b.ok, c.ok]).toEqual([true, true, true])
      expect(claimCountForSession('s1')).toBe(3)
    })

    it('releases reference-counted: one release does not free another claim', () => {
      const a = grant('s1')
      const b = grant('s1')

      a.release()
      expect(hasClaimsForSession('s1')).toBe(true)
      expect(claimCountForSession('s1')).toBe(1)

      b.release()
      expect(hasClaimsForSession('s1')).toBe(false)
    })

    it('release is idempotent — calling it twice does not free someone else', () => {
      const a = grant('s1')
      const b = grant('s1')

      a.release()
      a.release()
      a.release()
      // The defect this guards: a count-based release would have taken `b` with it.
      expect(claimCountForSession('s1')).toBe(1)

      b.release()
      expect(claimCountForSession('s1')).toBe(0)
    })

    it('gives every claim a distinct token', () => {
      expect(grant('s1').token).not.toBe(grant('s1').token)
    })

    it('keeps sessions independent', () => {
      registerSession('a')
      registerSession('b')
      const a = grant('a')
      grant('b')
      a.release()
      expect(hasClaimsForSession('a')).toBe(false)
      expect(hasClaimsForSession('b')).toBe(true)
    })

    it('refuses a claim on a closing session', () => {
      expect(beginSessionClose('s1')).toBe(true)
      const claim = claimSession('s1')
      expect(claim.ok).toBe(false)
      if (claim.ok) throw new Error('unreachable')
      expect(claim.reason).toBe('closing')
    })

    it('refuses while an existing claim is still outstanding', () => {
      const claim = grant('s1')
      // The session cannot close yet; the caller must defer.
      expect(beginSessionClose('s1')).toBe(false)
      expect(isSessionClosing('s1')).toBe(true)
      claim.release()
      // The closing state survives the last release, so a straggler cannot claim it.
      expect(isSessionClosing('s1')).toBe(true)
      expect(claimSession('s1').ok).toBe(false)
    })

    it('a release arriving after the id was retired is a harmless no-op', () => {
      const claim = grant('s1')
      beginSessionClose('s1')
      completeSessionClose('s1')
      expect(() => claim.release()).not.toThrow()
      expect(__claimedSessionCount()).toBe(0)
      expect(claimSession('s1').ok).toBe(false)
    })
  })

  describe('completing a close', () => {
    beforeEach(() => registerSession('s1'))

    it('retires the id, and the retired id stays refused', () => {
      beginSessionClose('s1')
      completeSessionClose('s1')

      // Refused as `unknown`, not as `closing`: the entry is gone, which is the
      // durable answer. A tombstone is not involved.
      const claim = claimSession('s1')
      expect(claim.ok).toBe(false)
      if (claim.ok) throw new Error('unreachable')
      expect(claim.reason).toBe('unknown')
      expect(__trackedSessionCount()).toBe(0)
      expect(__claimedSessionCount()).toBe(0)
    })

    it('refuses a claim for an id that completed its close twice', () => {
      // The second `completeSessionClose` is a no-op rather than an error, and it
      // certainly must not recreate anything.
      beginSessionClose('s1')
      completeSessionClose('s1')
      completeSessionClose('s1')
      expect(claimSession('s1').ok).toBe(false)
      expect(__trackedSessionCount()).toBe(0)
    })

    it('a failed close stays closing and does not reopen the id', () => {
      // `releaseOrDefer` calls `completeSessionClose` only on resolve; on reject
      // the entry is left `CLOSING`. Pinned here because the regression would be
      // an id silently becoming usable while the backend may have dropped it.
      beginSessionClose('s1')
      // …the IPC rejects, so nothing calls `completeSessionClose`…
      expect(isSessionClosing('s1')).toBe(true)
      expect(claimSession('s1').ok).toBe(false)
    })

    it('a cancelled release reopens only a session that is actually closing', () => {
      beginSessionClose('s1')
      expect(claimSession('s1').ok).toBe(false)

      forgetSession('s1')
      expect(isSessionClosing('s1')).toBe(false)
      expect(isSessionActive('s1')).toBe(true)
      expect(claimSession('s1').ok).toBe(true)
    })

    it('forgetSession cannot create a session that was never registered', () => {
      // The dangerous misreading: treating a cancel as "make this id live".
      // Liveness comes from `registerSession` alone.
      forgetSession('never-registered')
      expect(isSessionActive('never-registered')).toBe(false)
      const claim = claimSession('never-registered')
      expect(claim.ok).toBe(false)
      if (claim.ok) throw new Error('unreachable')
      expect(claim.reason).toBe('unknown')
    })

    it('forgetSession cannot resurrect an id whose close already completed', () => {
      beginSessionClose('s1')
      completeSessionClose('s1')
      forgetSession('s1')
      expect(isSessionActive('s1')).toBe(false)
      expect(claimSession('s1').ok).toBe(false)
      expect(__trackedSessionCount()).toBe(0)
    })

    it('forgetSession on an active session leaves it active', () => {
      // Nothing was closing, so there is nothing to cancel. It must not delete a
      // live connection's entry.
      forgetSession('s1')
      expect(isSessionActive('s1')).toBe(true)
      expect(claimSession('s1').ok).toBe(true)
    })

    it('repeated close requests do not lose what the session was', () => {
      // `releaseOrDefer` is called from the effect body, the cleanup and a third time
      // "for good measure" (see the dock-close test). Each call re-marks the session
      // closing, so the flag describing what to restore has to survive being written
      // over — otherwise a cancel after the second request would retire a live
      // connection.
      beginSessionClose('s1')
      beginSessionClose('s1')
      beginSessionClose('s1')
      forgetSession('s1')
      expect(isSessionActive('s1')).toBe(true)
      expect(claimSession('s1').ok).toBe(true)
    })

    it('repeated close requests for an unknown id still cannot make it live', () => {
      // The mirror of the case above: re-marking must not accumulate liveness the
      // first request never granted.
      beginSessionClose('ghost')
      beginSessionClose('ghost')
      forgetSession('ghost')
      expect(isSessionActive('ghost')).toBe(false)
      expect(claimSession('ghost').ok).toBe(false)
      expect(__trackedSessionCount()).toBe(1)
    })
  })

  describe('the registry is bounded by live sessions', () => {
    it('4097 register/close cycles leave nothing behind and the first id stays refused', () => {
      // The exact boundary from #73: the old cap was 4096 with oldest-first
      // eviction, so the 4097th close pushed the first id out and made it
      // claimable again. With an allowlist the count is zero at the end and the
      // first id is refused because it is absent, not because it is remembered.
      for (let index = 0; index < 4097; index += 1) {
        const id = `ssh-cycle-${index}`
        registerSession(id)
        expect(claimSession(id).ok).toBe(true)
        beginSessionClose(id)
        completeSessionClose(id)
      }

      expect(__trackedSessionCount()).toBe(0)
      expect(__claimedSessionCount()).toBe(0)
      expect(claimSession('ssh-cycle-0').ok).toBe(false)
      expect(claimSession('ssh-cycle-4096').ok).toBe(false)
    })

    it('the registry size tracks open sessions, not the number ever opened', () => {
      // Two connections alive while 100 others came and went.
      registerSession('long-lived-a')
      registerSession('long-lived-b')
      for (let index = 0; index < 100; index += 1) {
        const id = `transient-${index}`
        registerSession(id)
        grant(id).release()
        beginSessionClose(id)
        completeSessionClose(id)
      }
      expect(__trackedSessionCount()).toBe(2)
      expect(isSessionActive('long-lived-a')).toBe(true)
      expect(isSessionActive('long-lived-b')).toBe(true)
    })

    it('releasing every claim drops the claim bookkeeping but keeps the session', () => {
      registerSession('s1')
      grant('s1').release()
      // A leak here is the "unbounded map" failure: a long session with many
      // transfers would grow it forever.
      expect(__claimedSessionCount()).toBe(0)
      // …while the connection itself is still known, which is what makes the next
      // transfer admissible.
      expect(isSessionActive('s1')).toBe(true)
      expect(__trackedSessionCount()).toBe(1)
    })

    it('100 claims on one session, all released in reverse order', () => {
      registerSession('s1')
      const claims = []
      for (let index = 0; index < 100; index += 1) claims.push(claimSession('s1'))
      expect(claimCountForSession('s1')).toBe(100)

      for (let index = claims.length - 1; index >= 0; index -= 1) {
        const claim = claims[index]
        if (claim.ok) claim.release()
      }
      expect(claimCountForSession('s1')).toBe(0)
      expect(__claimedSessionCount()).toBe(0)
    })
  })

  describe('isSessionIdle consults both sources', () => {
    beforeEach(() => registerSession('s1'))

    it('is false while a claim is outstanding even with an empty queue', () => {
      const queueAnswer = hasTransfersForSession('s1')
      const claim = grant('s1')

      // This is the exact divergence the old code could not see.
      expect(queueAnswer).toBe(false)
      expect(isSessionIdle('s1')).toBe(false)
      expect(isSessionBusy('s1')).toBe(true)
      claim.release()
    })

    it('is false while a queued transfer exists even with no claim', () => {
      useTransferQueue.setState({
        transfers: [
          {
            id: 't1',
            kind: 'upload',
            name: 'a.bin',
            localPath: '/tmp/a.bin',
            remotePath: '/srv/a.bin',
            sessionId: 's1',
            status: 'queued',
            bytesDone: 0,
            bytesTotal: 10,
            speed: 0,
            startedAt: 1,
          },
        ],
      })
      expect(isSessionIdle('s1')).toBe(false)
    })

    it('is true only when neither source has anything', () => {
      expect(isSessionIdle('s1')).toBe(true)
    })
  })

  describe('uploadFile claims before the first await', () => {
    beforeEach(() => registerSession('sess-1'))

    it('the session is busy while the listener is still installing', async () => {
      const gate = deferred()
      configureTransferRuntime({
        available: true,
        installProgressListener: () => gate.promise,
        run: vi.fn(async () => undefined),
      })

      const pending = uploadFile({
        sessionId: 'sess-1',
        localPath: '/tmp/a.bin',
        remotePath: '/srv/a.bin',
        bytesTotal: 100,
      })

      // Nothing has been enqueued yet — this is the window.
      await flush()
      expect(useTransferQueue.getState().transfers).toHaveLength(0)
      expect(hasTransfersForSession('sess-1')).toBe(false)
      // And yet the session is in use. The old implementation answered `false` to
      // the second question too, which is how the connection got closed.
      expect(isSessionIdle('sess-1')).toBe(false)

      gate.resolve()
      await pending
      expect(hasClaimsForSession('sess-1')).toBe(false)
    })

    it('the claim hands over to the queue record without a gap', async () => {
      configureTransferRuntime({
        available: true,
        installProgressListener: async () => undefined,
        run: vi.fn(async () => new Promise<void>(() => undefined)),
      })

      await uploadFile({
        sessionId: 'sess-1',
        localPath: '/tmp/a.bin',
        remotePath: '/srv/a.bin',
        bytesTotal: 100,
      })

      // The claim is gone, but the queue now owns the session — at no point was
      // neither true.
      expect(hasClaimsForSession('sess-1')).toBe(false)
      expect(hasTransfersForSession('sess-1')).toBe(true)
      expect(isSessionIdle('sess-1')).toBe(false)
    })

    it('releases the claim when the listener cannot be installed', async () => {
      configureTransferRuntime({
        available: true,
        installProgressListener: async () => {
          throw new Error('listen failed')
        },
        run: vi.fn(async () => undefined),
      })

      await uploadFile({
        sessionId: 'sess-1',
        localPath: '/tmp/a.bin',
        remotePath: '/srv/a.bin',
      })

      // A blocked transfer must not leave the session permanently busy.
      expect(hasClaimsForSession('sess-1')).toBe(false)
      const transfers = useTransferQueue.getState().transfers
      expect(transfers).toHaveLength(1)
      expect(transfers[0].status).toBe('error')
    })

    it('releases the claim when scheduleTransfer throws', async () => {
      configureTransferRuntime({
        available: true,
        installProgressListener: async () => undefined,
        run: vi.fn(async () => undefined),
      })

      // Force the enqueue path to throw by breaking the store method for one call.
      const original = useTransferQueue.getState().enqueue
      useTransferQueue.setState({
        enqueue: () => {
          throw new Error('store exploded')
        },
      })
      try {
        await expect(
          uploadFile({
            sessionId: 'sess-1',
            localPath: '/tmp/a.bin',
            remotePath: '/srv/a.bin',
          }),
        ).rejects.toThrow('store exploded')
        // The `finally` is the only thing that can free this.
        expect(hasClaimsForSession('sess-1')).toBe(false)
      } finally {
        useTransferQueue.setState({ enqueue: original })
      }
    })

    it('refuses to start on a closing session and reports it', async () => {
      configureTransferRuntime({
        available: true,
        installProgressListener: async () => undefined,
        run: vi.fn(async () => undefined),
      })
      beginSessionClose('sess-1')

      await uploadFile({
        sessionId: 'sess-1',
        localPath: '/tmp/a.bin',
        remotePath: '/srv/a.bin',
      })

      const transfers = useTransferQueue.getState().transfers
      expect(transfers).toHaveLength(1)
      expect(transfers[0].status).toBe('error')
      expect(transfers[0].message).toContain('closing')
    })

    it('refuses to start on an id the app never registered', async () => {
      // The user-visible half of the allowlist. Before #73 this started a
      // transfer on a connection that does not exist, and the failure surfaced
      // later as a raw backend error instead of "reopen the folder".
      configureTransferRuntime({
        available: true,
        installProgressListener: async () => undefined,
        run: vi.fn(async () => undefined),
      })

      await uploadFile({
        sessionId: 'nobody-registered-this',
        localPath: '/tmp/a.bin',
        remotePath: '/srv/a.bin',
      })

      const transfers = useTransferQueue.getState().transfers
      expect(transfers).toHaveLength(1)
      expect(transfers[0].status).toBe('error')
      expect(transfers[0].message).toContain('closing')
      // Nothing was admitted and nothing is left claimed.
      expect(__claimedSessionCount()).toBe(0)
    })

    it('downloadFile takes the same claim', async () => {
      registerSession('sess-d')
      const gate = deferred()
      configureTransferRuntime({
        available: true,
        installProgressListener: () => gate.promise,
        run: vi.fn(async () => undefined),
      })

      const pending = downloadFile({
        sessionId: 'sess-d',
        remotePath: '/srv/a.bin',
        localPath: '/tmp/a.bin',
      })
      await flush()
      expect(isSessionIdle('sess-d')).toBe(false)

      gate.resolve()
      await pending
      expect(hasClaimsForSession('sess-d')).toBe(false)
    })
  })

  describe('uploadPaths / drag-drop take claims per file', () => {
    it('a batch holds one claim per file until the batch is scheduled', async () => {
      registerSession('sess-b')
      const gate = deferred()
      configureTransferRuntime({
        available: true,
        installProgressListener: () => gate.promise,
        run: vi.fn(async () => new Promise<void>(() => undefined)),
      })

      const pending = uploadPaths({
        sessionId: 'sess-b',
        remoteDir: '/srv',
        localPaths: ['/tmp/a.bin', '/tmp/b.bin', '/tmp/c.bin'],
      })
      await flush()

      // All three are preparing concurrently; the count proves the reference
      // counting rather than a single boolean.
      expect(claimCountForSession('sess-b')).toBe(3)
      expect(isSessionIdle('sess-b')).toBe(false)

      gate.resolve()
      await pending
      expect(hasClaimsForSession('sess-b')).toBe(false)
      expect(hasTransfersForSession('sess-b')).toBe(true)
    })
  })

  describe('no leakage across many cycles', () => {
    it('100 interrupted uploads leave no claim behind', async () => {
      configureTransferRuntime({
        available: true,
        installProgressListener: async () => undefined,
        run: vi.fn(async () => new Promise<void>(() => undefined)),
      })

      for (let index = 0; index < 100; index += 1) {
        const sessionId = `sess-${index}`
        registerSession(sessionId)
        await uploadFile({
          sessionId,
          localPath: `/tmp/a${index}.bin`,
          remotePath: `/srv/a${index}.bin`,
        })
        // A fresh id per iteration would hide a leak; release the queue's grip on
        // it the way a finished transfer would.
        useTransferQueue.setState({ transfers: [] })
        // And close the connection the way the dock would.
        beginSessionClose(sessionId)
        completeSessionClose(sessionId)
      }

      expect(__claimedSessionCount()).toBe(0)
      expect(__trackedSessionCount()).toBe(0)
      // The oldest id is refused because no entry exists for it.
      expect(claimSession('sess-0').ok).toBe(false)
    })
  })
})
