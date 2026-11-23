/**
 * T13 — 校验在异常与数据变化下的行为。
 *
 * ## 这个文件补的是哪一部分
 *
 * `sftp-transfer-integrity.test.ts` 覆盖了正常路径（两侧成功、不一致、单侧失败）；
 * `sftp-transfer-verify-lifecycle.test.ts` 覆盖了 claim 与槽位。两份都在，所以这里
 * **不重复**它们，只补 T13 点名而未被覆盖的四种情形：
 *
 *   1. **传输后文件被篡改** —— 远端内容在 done 之后、hash 之前改变。VERIFIED 必须要求
 *      **独立的两端 SHA-256 一致**，所以篡改必须读成 mismatch，不能读成 verified。
 *   2. **校验期间断线** —— 远端 hash 失败，本地成功。结果是 indeterminate，
 *      且**不能**显示 Verified。
 *   3. **迟到事件** —— 上一轮传输的 `checksum-done` 在本轮之后到达。它必须被忽略，
 *      不能改写本轮结论。
 *   4. **重复 Done** —— 两次 `done` 只启动一次校验（已有断言，这里补「重复 done
 *      不会把已验证的结论重置为 computing」）。
 *
 * ## 一条贯穿全部用例的规则
 *
 * **失败或不可判断不能显示 Verified，也不能静默删除文件。** 后者无法在单测里断言
 * （没有文件系统），所以由 `t13-checksum-e2e` 在真实 sshd 上验证；这里断言前者。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checksumLocal: vi.fn(),
  checksumRemote: vi.fn(),
  sftpDelete: vi.fn(),
}))

vi.mock('@/features/terminal/services/sftp', () => ({
  sftpService: {
    checksumLocal: mocks.checksumLocal,
    checksumRemote: mocks.checksumRemote,
    sftpDelete: mocks.sftpDelete,
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

function installRuntime() {
  const runtime: TransferRuntime = {
    available: true,
    async installProgressListener() {},
    run: () => new Promise<void>(() => {}),
  }
  configureTransferRuntime(runtime)
}

async function flush(times = 12) {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

const record = (id: string) =>
  useTransferQueue.getState().transfers.find(entry => entry.id === id)

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
    .transfers.find(entry => entry.status === 'running')
  if (!running) throw new Error('the upload did not start')
  return running.id
}

beforeEach(() => {
  useTransferQueue.setState({ transfers: [], panelOpen: false })
  __resetTransferQueueForTests()
  __resetProgressListenerForTests()
  __resetSessionClaimsForTests()
  registerSession('s1')
  vi.clearAllMocks()
  installRuntime()
})

describe('T13 — a changed file is never reported as verified', () => {
  it('a remote file modified after the transfer reads as mismatch', async () => {
    /*
     * The scenario the whole feature exists for: the bytes that landed are not the bytes
     * that were sent. Here the local file is what the user has, the remote file changed
     * after `done`, and the two hashes differ.
     *
     * A check that used the *transfer's* byte count, or that trusted the server's own
     * report, would call this verified. Two independent SHA-256 values cannot.
     */
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'the-sent-bytes' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'tampered-bytes' })
    const id = await startedUpload()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await vi.waitFor(() => expect(mocks.checksumRemote).toHaveBeenCalled())

    expect(checksumVerdict(record(id)).verdict).toBe('mismatch')
    // And nothing deleted the user's file in response.
    expect(mocks.sftpDelete).not.toHaveBeenCalled()
  })

  it('a disconnect during verification is indeterminate, not verified and not mismatch', async () => {
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({
      success: false,
      message: 'session not found',
    })
    const id = await startedUpload()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await vi.waitFor(() => expect(mocks.checksumRemote).toHaveBeenCalled())

    const verdict = checksumVerdict(record(id))
    expect(verdict.verdict).toBe('indeterminate')
    expect(verdict.verdict).not.toBe('verified')
    expect(verdict.verdict).not.toBe('mismatch')
    expect(verdict.failedSide).toBe('remote')
  })

  it('a local hash failure is indeterminate even when the remote hash succeeded', async () => {
    // The mirror: the app cannot read its own file (deleted between transfer and
    // check). That says nothing about whether the remote copy is correct.
    mocks.checksumLocal.mockResolvedValue({ success: false, message: 'ENOENT' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'bb' })
    const id = await startedUpload()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await vi.waitFor(() => expect(mocks.checksumRemote).toHaveBeenCalled())

    expect(checksumVerdict(record(id)).verdict).toBe('indeterminate')
  })

  it('a late checksum-done from an earlier transfer does not rewrite this one', async () => {
    /*
     * Events are dispatched by `transferId`. A late event carrying a *different* id must
     * not touch this record at all — that is what makes "the old host's hash" harmless.
     * (The same-host, same-path case is T14's subject; here it is a foreign id.)
     */
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'aa' })
    const id = await startedUpload()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await vi.waitFor(() => expect(checksumVerdict(record(id)).verdict).toBe('verified'))

    handleProgressEvent({
      transferId: 'ghost-transfer',
      kind: 'checksum-done',
      bytesDone: 1024,
      bytesTotal: 1024,
      message: 'deadbeef',
      side: 'remote',
    })
    await flush()

    const checksum = record(id)!.checksum!
    expect(checksum.remoteHash).toBe('aa')
    expect(checksumVerdict(record(id)).verdict).toBe('verified')
  })

  it('a duplicate done does not reset a verified verdict back to computing', async () => {
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'aa' })
    const id = await startedUpload()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await vi.waitFor(() => expect(checksumVerdict(record(id)).verdict).toBe('verified'))

    // The backend can repeat `done` (retry, reconnect replay). It must not restart the
    // check, and must not put the row back into `computing`.
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await flush()

    expect(checksumVerdict(record(id)).verdict).toBe('verified')
    // One remote read, not two: the second `done` was refused by the state machine.
    expect(mocks.checksumRemote).toHaveBeenCalledTimes(1)
  })

  it('a checksum-progress arriving after the verdict does not resurrect computing', async () => {
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'aa' })
    const id = await startedUpload()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await vi.waitFor(() => expect(checksumVerdict(record(id)).verdict).toBe('verified'))

    handleProgressEvent({
      transferId: id,
      kind: 'checksum-progress',
      bytesDone: 512,
      bytesTotal: 1024,
      side: 'remote',
    })
    await flush()

    // Progress updates the counter it owns; it must not change either side's status.
    expect(checksumVerdict(record(id)).verdict).toBe('verified')
  })

  it('a mismatch is never silently repaired by deleting either side', async () => {
    /*
     * The rule from the task: "失败或不可判断不能显示 Verified，也不能静默删除文件".
     * A mismatch is information, not an instruction — the app cannot know which side is
     * correct, so removing one would destroy the user's data on a guess.
     */
    mocks.checksumLocal.mockResolvedValue({ success: true, hash: 'aa' })
    mocks.checksumRemote.mockResolvedValue({ success: true, hash: 'bb' })
    const id = await startedUpload()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await vi.waitFor(() => expect(checksumVerdict(record(id)).verdict).toBe('mismatch'))

    expect(mocks.sftpDelete).not.toHaveBeenCalled()
    // The record still exists and still says the transfer completed.
    expect(record(id)!.status).toBe('done')
  })
})
