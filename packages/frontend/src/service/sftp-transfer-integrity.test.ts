// The integrity check's capability, held apart from whether anything starts it.
//
// ## What is wired end to end
//
// `sftp_local_checksum` and `sftp_remote_checksum` are real Rust commands
// (`src-tauri/src/sftp.rs`: one hashes a local file, one streams the remote file).
// `sftpService.checksumLocal` / `checksumRemote` invoke them; `verifyChecksum` runs
// both and writes the results into the transfer record; the store compares the two
// hashes and sets `matches`.
//
// These tests cover that chain, because the store's comparison logic — where a "both
// sides hashed but the verdict was never computed" bug would live — had no test at all.
//
// ## What is NOT wired, and is deliberately not asserted here
//
// Nothing calls `verifyChecksum`. One hit in the whole frontend: the re-export in
// `sftp-transfer.ts`. Every upload and download therefore completes with `checksum`
// undefined, and no UI renders `record.checksum` either.
//
// That gap is **recorded, not tested**. A test asserting
// `expect(checksumLocal).not.toHaveBeenCalled()` would pass, would look like coverage,
// and would make the defect permanent. This repository has hit that shape before:
// `orphanedSecrets` was declared, documented as exactly its one use case, initialised
// to 0 and never incremented; and a green test once asserted that a forged delimiter
// left in the body was correct behaviour. Both survived review precisely because a
// passing test vouched for them.
//
// The wiring is its own change: making verification run on every transfer changes what
// "done" means, and a mismatch the user cannot see is not a fix. See the T08 notes.

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

vi.mock('@/service/ssh', () => ({
  sshService: {},
}))

import { useTransferQueue } from '@/store/transfer-queue'
import { __resetTransferQueueForTests } from './sftp-transfer-queue'
import { verifyChecksum } from './sftp-transfer'

/** A transfer record for `verifyChecksum` to write into. */
function finishedUpload(): string {
  return useTransferQueue.getState().enqueue({
    // Empty id: the store's own `makeId()` fills it in, the same path every real
    // transfer takes. `enqueue` is the store's constructor, not a test fixture.
    id: '',
    kind: 'upload',
    name: 'payload.bin',
    localPath: '/tmp/payload.bin',
    remotePath: '/srv/payload.bin',
    sessionId: 's1',
    bytesTotal: 1024,
  })
}

const checksumOf = (id: string) =>
  useTransferQueue.getState().transfers.find(record => record.id === id)?.checksum

beforeEach(() => {
  vi.clearAllMocks()
  __resetTransferQueueForTests()
})

describe('verifyChecksum hashes both sides and decides', () => {
  it('asks for the local and the remote hash with the paths it was given', async () => {
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'aa' })
    const id = finishedUpload()

    await verifyChecksum({
      transferId: id,
      sessionId: 's1',
      localPath: '/tmp/payload.bin',
      remotePath: '/srv/payload.bin',
    })

    expect(mocks.checksumLocal).toHaveBeenCalledWith(id, '/tmp/payload.bin')
    expect(mocks.checksumRemote).toHaveBeenCalledWith(id, 's1', '/srv/payload.bin')
  })

  it('records a match when the two hashes agree', async () => {
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'aa' })
    const id = finishedUpload()

    await verifyChecksum({
      transferId: id, sessionId: 's1',
      localPath: '/tmp/payload.bin', remotePath: '/srv/payload.bin',
    })

    expect(checksumOf(id)).toMatchObject({
      algorithm: 'sha256',
      localStatus: 'done',
      remoteStatus: 'done',
      matches: true,
    })
  })

  it('records a mismatch when they disagree — the case the feature exists for', async () => {
    /*
     * The one outcome that matters. A truncated upload, a server that wrote a different
     * file, a decode that changed the bytes: all three land here, and all three would
     * otherwise be reported as a successful transfer.
     */
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'bb' })
    const id = finishedUpload()

    await verifyChecksum({
      transferId: id, sessionId: 's1',
      localPath: '/tmp/payload.bin', remotePath: '/srv/payload.bin',
    })

    expect(checksumOf(id)?.matches).toBe(false)
  })

  it('leaves matches undecided when one side failed, rather than guessing', async () => {
    /*
     * `matches` must stay unset, not become `false`. "The remote hash could not be
     * computed" and "the hashes differ" are different facts, and collapsing them would
     * report a server error as a corrupted file.
     */
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({ success: false, message: 'permission denied' })
    const id = finishedUpload()

    await verifyChecksum({
      transferId: id, sessionId: 's1',
      localPath: '/tmp/payload.bin', remotePath: '/srv/payload.bin',
    })

    const checksum = checksumOf(id)
    expect(checksum?.remoteStatus).toBe('error')
    expect(checksum?.remoteError).toBe('permission denied')
    expect(checksum?.matches).toBeUndefined()
  })

  it('carries the local failure reason through as well', async () => {
    mocks.checksumLocal.mockResolvedValue({ success: false, message: 'ENOENT' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'bb' })
    const id = finishedUpload()

    await verifyChecksum({
      transferId: id, sessionId: 's1',
      localPath: '/tmp/payload.bin', remotePath: '/srv/payload.bin',
    })

    const checksum = checksumOf(id)
    expect(checksum?.localStatus).toBe('error')
    expect(checksum?.localError).toBe('ENOENT')
    expect(checksum?.matches).toBeUndefined()
  })
})
