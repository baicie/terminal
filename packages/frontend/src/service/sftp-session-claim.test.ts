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
// These tests drive the real `uploadFile` / `downloadFile` with a controlled
// `installProgressListener` promise, so the window is opened deliberately rather
// than raced for. The "old implementation fails" half of each case is asserted by
// checking the claim-side question directly — `isSessionIdle` must answer "busy"
// during the await, and the pre-fix queue-only question answered "idle".

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
  forgetSession,
  isSessionClosing,
  __resetSessionClaimsForTests,
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

  describe('claim primitives', () => {
    it('is synchronous — a claim taken before any await is visible immediately', () => {
      // The entire point: no `await` between "the user asked" and "the session is
      // marked in use".
      const claim = claimSession('s1')
      expect(claim.ok).toBe(true)
      expect(hasClaimsForSession('s1')).toBe(true)
    })

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
      const a = claimSession('s1')
      const b = claimSession('s1')
      if (!a.ok || !b.ok) throw new Error('claims should be granted')

      a.release()
      expect(hasClaimsForSession('s1')).toBe(true)
      expect(claimCountForSession('s1')).toBe(1)

      b.release()
      expect(hasClaimsForSession('s1')).toBe(false)
    })

    it('release is idempotent — calling it twice does not free someone else', () => {
      const a = claimSession('s1')
      const b = claimSession('s1')
      if (!a.ok || !b.ok) throw new Error('claims should be granted')

      a.release()
      a.release()
      a.release()
      // The defect this guards: a count-based release would have taken `b` with it.
      expect(claimCountForSession('s1')).toBe(1)

      b.release()
      expect(claimCountForSession('s1')).toBe(0)
    })

    it('gives every claim a distinct token', () => {
      const a = claimSession('s1')
      const b = claimSession('s1')
      if (!a.ok || !b.ok) throw new Error('claims should be granted')
      expect(a.token).not.toBe(b.token)
    })

    it('keeps sessions independent', () => {
      const a = claimSession('a')
      claimSession('b')
      if (!a.ok) throw new Error('claim should be granted')
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
      const claim = claimSession('s1')
      if (!claim.ok) throw new Error('claim should be granted')
      // The session cannot close yet; the caller must defer.
      expect(beginSessionClose('s1')).toBe(false)
      expect(isSessionClosing('s1')).toBe(true)
      claim.release()
      // The marker survives the last release, so a straggler cannot claim it.
      expect(isSessionClosing('s1')).toBe(true)
      expect(claimSession('s1').ok).toBe(false)
    })

    it('forgetSession makes a cancelled release usable again', () => {
      beginSessionClose('s1')
      expect(claimSession('s1').ok).toBe(false)
      forgetSession('s1')
      expect(isSessionClosing('s1')).toBe(false)
      expect(claimSession('s1').ok).toBe(true)
    })

    it('a completed close forgets the session, so the map does not grow', () => {
      // The defect this replaced: `beginSessionClose` created a record for every
      // connection and nothing ever removed it. Session ids are unique and never
      // reused, so refusing claims for the id is harmless — but keeping the record
      // forever is not: 1000 dock open/close cycles left 1000 entries.
      beginSessionClose('s1')
      expect(isSessionClosing('s1')).toBe(true)
      forgetSession('s1')
      expect(__claimedSessionCount()).toBe(0)
      expect(isSessionClosing('s1')).toBe(false)
    })

    it('forgetting an id that still has a claim does not resurrect it', () => {
      // `releaseOrDefer` only forgets once nothing is claimed, so this ordering
      // cannot happen in production. It is pinned anyway because a release that
      // arrives after its entry was dropped must be a no-op, not a crash.
      const claim = claimSession('s1')
      if (!claim.ok) throw new Error('claim should be granted')
      forgetSession('s1')
      expect(() => claim.release()).not.toThrow()
      expect(__claimedSessionCount()).toBe(0)
    })

    it('drops the bookkeeping once nothing is claimed and nothing closed', () => {
      const claim = claimSession('s1')
      if (!claim.ok) throw new Error('claim should be granted')
      expect(__claimedSessionCount()).toBe(1)
      claim.release()
      // A leak here is the "unbounded map" failure: a long session with many
      // transfers would grow it forever.
      expect(__claimedSessionCount()).toBe(0)
    })
  })

  describe('isSessionIdle consults both sources', () => {
    it('is false while a claim is outstanding even with an empty queue', () => {
      const queueAnswer = hasTransfersForSession('s1')
      const claim = claimSession('s1')
      if (!claim.ok) throw new Error('claim should be granted')

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

    it('downloadFile takes the same claim', async () => {
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
        await uploadFile({
          sessionId: `sess-${index}`,
          localPath: `/tmp/a${index}.bin`,
          remotePath: `/srv/a${index}.bin`,
        })
        // A fresh id per iteration would hide a leak; release the queue's grip on
        // it the way a finished transfer would.
        useTransferQueue.setState({ transfers: [] })
      }

      expect(__claimedSessionCount()).toBe(0)
    })

    it('100 claims on one session, all released in reverse order', () => {
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
})
