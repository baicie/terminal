// The integrity check, driven the way production drives it.
//
// ## What changed and why the old file had to be rewritten
//
// The previous version of this file tested `verifyChecksum` in isolation and said, in
// a comment, that nothing called it. That was honest, but it left the actual defect
// untested: **a completed transfer was never verified, and the UI had no way to tell
// "bytes written" from "both ends agree"**.
//
// The red test for that is not `expect(checksumLocal).not.toHaveBeenCalled()` — a
// test that asserts the absence of behaviour passes on the broken implementation and
// then has to be deleted. The red test is the positive one: drive the queue's own
// completion event and require that a hash actually gets computed. On the
// pre-change implementation the remote hash was never requested, so it fails.
//
// ## What "verified" means
//
// `done` is the transfer. `verified` is the check. They are separate fields, and
// `checksumVerdict()` derives the verdict from the two hash statuses rather than
// storing a third value that can drift from them.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checksumLocal: vi.fn(),
  checksumRemote: vi.fn(),
}))

vi.mock('@/features/terminal/services/sftp', () => ({
  sftpService: {
    checksumLocal: mocks.checksumLocal,
    checksumRemote: mocks.checksumRemote,
  },
}))

vi.mock('@/service/notifications', () => ({
  notify: vi.fn(async () => undefined),
}))

import { useTransferQueue } from '@/store/transfer-queue'
import { checksumVerdict } from '@/store/transfer-checksum-verdict'
import { __resetSessionClaimsForTests, registerSession } from './sftp-session-claim'
import {
  __resetProgressListenerForTests,
  configureTransferRuntime,
  handleProgressEvent,
  uploadFile,
  type TransferRuntime,
} from './sftp-transfer'
import { __resetTransferQueueForTests } from './sftp-transfer-queue'

/** A runtime whose transfer never settles on its own; the test emits `done`. */
function installRuntime(): void {
  const runtime: TransferRuntime = {
    available: true,
    async installProgressListener() {},
    run: () => new Promise<void>(() => {}),
  }
  configureTransferRuntime(runtime)
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

/** Enqueue one upload and let the queue start it; returns its transfer id. */
async function startedUpload(): Promise<string> {
  await uploadFile({
    sessionId: 's1',
    localPath: '/tmp/payload.bin',
    remotePath: '/srv/payload.bin',
    target: { hostname: 'test.example.com', port: 22, username: 'u', remotePath: '/srv/payload.bin' },
    bytesTotal: 1024,
  })
  await flush()
  const running = useTransferQueue
    .getState()
    .transfers.find(record => record.status === 'running')
  if (!running) throw new Error('the upload was not started')
  return running.id
}

const record = (id: string) =>
  useTransferQueue.getState().transfers.find(entry => entry.id === id)

beforeEach(() => {
  useTransferQueue.setState({ transfers: [], panelOpen: false })
  __resetTransferQueueForTests()
  __resetProgressListenerForTests()
  __resetSessionClaimsForTests()
  registerSession('s1')
  vi.clearAllMocks()
  installRuntime()
})

describe('a finished transfer is actually verified', () => {
  it('hashes both sides after the backend reports done — the wiring that did not exist', async () => {
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'aa' })
    const id = await startedUpload()

    handleProgressEvent({
      transferId: id,
      kind: 'done',
      bytesDone: 1024,
      bytesTotal: 1024,
    })
    await flush()
    // The hashes are async; give the verifier's microtasks room to finish.
    await vi.waitFor(() => expect(mocks.checksumRemote).toHaveBeenCalled())

    expect(mocks.checksumLocal).toHaveBeenCalledWith(id, '/tmp/payload.bin')
    expect(mocks.checksumRemote).toHaveBeenCalledWith(id, 's1', '/srv/payload.bin')
    expect(checksumVerdict(record(id)).verdict).toBe('verified')
  })

  it('reports a mismatch when the two hashes disagree — the case the feature exists for', async () => {
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'bb' })
    const id = await startedUpload()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await vi.waitFor(() => expect(mocks.checksumRemote).toHaveBeenCalled())

    expect(record(id)!.status).toBe('done')
    expect(checksumVerdict(record(id)).verdict).toBe('mismatch')
  })

  it('does not call a one-sided failure a mismatch', async () => {
    /*
     * "The remote hash could not be computed" and "the hashes differ" are different
     * facts. Collapsing them reports a server error as a corrupted file.
     */
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({ success: false, message: 'permission denied' })
    const id = await startedUpload()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await vi.waitFor(() => expect(mocks.checksumRemote).toHaveBeenCalled())

    const verdict = checksumVerdict(record(id))
    expect(verdict.verdict).toBe('indeterminate')
    expect(verdict.failedSide).toBe('remote')
    expect(verdict.error).toBe('permission denied')
  })

  it('carries the local failure reason through as well', async () => {
    mocks.checksumLocal.mockResolvedValue({ success: false, message: 'ENOENT' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'bb' })
    const id = await startedUpload()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await vi.waitFor(() => expect(mocks.checksumRemote).toHaveBeenCalled())

    const verdict = checksumVerdict(record(id))
    expect(verdict.verdict).toBe('indeterminate')
    expect(verdict.failedSide).toBe('local')
    expect(verdict.error).toBe('ENOENT')
  })

  it('a transfer that failed is never verified at all', async () => {
    const id = await startedUpload()
    handleProgressEvent({
      transferId: id,
      kind: 'error',
      bytesDone: 0,
      bytesTotal: 1024,
      message: 'connection reset',
    })
    await flush()

    expect(record(id)!.status).toBe('error')
    expect(mocks.checksumLocal).not.toHaveBeenCalled()
    expect(checksumVerdict(record(id)).verdict).toBe('unchecked')
  })

  it('checksum progress never rewrites the finished transfer\'s byte count', async () => {
    /*
     * The scenario from the task, driven through the queue's event entry point: a
     * 100 MiB upload finishes, then the remote checksum reports 20 MiB read. The row
     * used to render "20 MB / 100 MB, 20%" for a transfer that had completed, with a
     * negative speed and an ETA for bytes that were already on the server.
     */
    const bytes = 100 * 1024 * 1024
    let releaseRemote: (() => void) | null = null
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockImplementation(
      () => new Promise(resolve => {
        releaseRemote = () => resolve({ success: true, hash: 'aa' })
      }),
    )
    const id = await startedUpload()
    handleProgressEvent({ transferId: id, kind: 'progress', bytesDone: bytes, bytesTotal: bytes })
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: bytes, bytesTotal: bytes })
    await vi.waitFor(() => expect(mocks.checksumRemote).toHaveBeenCalled())

    handleProgressEvent({
      transferId: id,
      kind: 'checksum-progress',
      bytesDone: 20 * 1024 * 1024,
      bytesTotal: bytes,
      side: 'remote',
    })
    await flush()

    const during = record(id)!
    expect(during.bytesDone).toBe(bytes)
    expect(during.bytesTotal).toBe(bytes)
    expect(during.checksum!.bytesDone).toBe(20 * 1024 * 1024)

    releaseRemote!()
    await vi.waitFor(() => expect(checksumVerdict(record(id)).verdict).toBe('verified'))
    const after = record(id)!
    expect(after.bytesDone).toBe(bytes)
    expect(after.bytesTotal).toBe(bytes)
  })

  it('a duplicate done event does not hash the remote file twice', async () => {
    // A second `done` cannot start a second verification: the first one already
    // released the slot, and a double remote read is a real cost on a real server.
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'aa' })
    const id = await startedUpload()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await vi.waitFor(() => expect(mocks.checksumRemote).toHaveBeenCalled())
    await flush()

    expect(mocks.checksumRemote).toHaveBeenCalledTimes(1)
  })
})

describe('checksum events from both Rust commands do not reset each other', () => {
  it('the remote checksum-start must not wipe the local result that already landed', async () => {
    /*
     * ## The stall the GUI measured
     *
     * `verifyChecksum` runs `sftp_local_checksum`, writes its result, then runs
     * `sftp_remote_checksum`. **Both** Rust commands emit `checksum-start`, and the
     * channel handler answered every `checksum-start` with `initChecksum` — which
     * rebuilds the record's `checksum` object from scratch:
     *
     *     localStatus:  kind === 'download' ? 'pending' : 'computing'
     *     remoteStatus: kind === 'upload' ? 'pending' : 'computing'
     *
     * So the remote command's `checksum-start`, arriving *after* the local hash had
     * been recorded, reset `localStatus` from `done` to `pending`. `checksum-progress`
     * only carries the remote side, so nothing ever set local back: the row stayed
     * `computing` for ever with `matches` never decided.
     *
     * Measured in `e2e-06` on a 3 MiB upload: the verdict stopped at 85% and did not
     * move for 30 s of sampling (`integritySamples`, twelve identical readings).
     *
     * The fix is that a start event only initialises what is not already known.
     */
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    let releaseRemote: ((value: unknown) => void) | null = null
    mocks.checksumRemote.mockImplementation(
      () =>
        new Promise(resolve => {
          releaseRemote = resolve
        }),
    )

    const id = await startedUpload()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await vi.waitFor(() => expect(mocks.checksumRemote).toHaveBeenCalled())
    // The local hash has landed by now.
    expect(record(id)!.checksum!.localStatus).toBe('done')

    // The remote command announces itself — the event that used to reset local.
    handleProgressEvent({
      transferId: id,
      kind: 'checksum-start',
      bytesDone: 0,
      bytesTotal: 1024,
      side: 'remote',
    })
    await flush()

    expect(record(id)!.checksum!.localStatus).toBe('done')
    expect(record(id)!.checksum!.localHash).toBe('aa')

    releaseRemote!({ success: true, hash: 'aa' })
    await vi.waitFor(() => expect(checksumVerdict(record(id)).verdict).toBe('verified'))
  })

  it('a checksum-start for a side that is still pending does initialise it', async () => {
    // The fix must not turn the start event into a no-op: when nothing has been
    // recorded for that side yet, it is what puts the side into `computing` so the UI
    // can show progress at all.
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'aa' })
    const id = await startedUpload()

    // Before any transfer/verify activity the record has no checksum at all.
    expect(record(id)!.checksum).toBeUndefined()
    handleProgressEvent({
      transferId: id,
      kind: 'checksum-start',
      bytesDone: 0,
      bytesTotal: 1024,
      side: 'remote',
    })
    await flush()

    const checksum = record(id)!.checksum!
    expect(checksum.algorithm).toBe('sha256')
    expect(checksum.remoteStatus).toBe('computing')
  })
})
