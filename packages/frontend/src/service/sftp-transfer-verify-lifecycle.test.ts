/**
 * 谁在用这个会话 —— 传输**和**它之后的校验。
 *
 * ## 为什么需要这个文件
 *
 * 校验发生在传输完成之后。准入层（`uploadFile`）的 claim 在 `scheduleTransfer()`
 * 就释放了，那是它的职责；如果校验不自己声明「这个连接还有人用」，那么
 * `isSessionIdle()` 在用户关闭 Dock 或切换 Host 时会回答「空闲」，连接被关掉，
 * 而校验还在读远端文件 —— 用户看到的是一个报 `SessionNotFound` 的验证，或者更糟：
 * 记录永远停在「正在校验」。
 *
 * ## 这个文件证明的三件事
 *
 * 1. 校验期间会话**不是**空闲的，校验结束后**是**（claim 没有泄漏）；
 * 2. 校验不占用传输的并发槽位 —— 传输已经结束，排在第 4 个的文件没有理由等哈希；
 * 3. 校验用的是**它自己那次传输**的 `sessionId`，所以旧 Host 的哈希不可能写进
 *    新 Host 的记录。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/service/notifications', () => ({
  notify: vi.fn(async () => undefined),
}))

import { useTransferQueue } from '@/store/transfer-queue'
import { checksumVerdict } from '@/store/transfer-checksum-verdict'
import {
  __resetSessionClaimsForTests,
  claimCountForSession,
  hasClaimsForSession,
  registerSession,
} from './sftp-session-claim'
import { isSessionIdle } from './sftp-transfer-session'
import {
  __resetProgressListenerForTests,
  configureTransferRuntime,
  downloadFile,
  handleProgressEvent,
  uploadFile,
  type TransferRuntime,
} from './sftp-transfer'
import { __resetTransferQueueForTests } from './sftp-transfer-queue'
import {
  __resetVerificationForTests,
  configureTransferVerifier,
} from './sftp-transfer-verify'

/**
 * A runtime plus a verifier the test resolves by hand, so it can observe the state
 * *during* verification rather than only afterwards.
 */
function install(options: { verifier?: 'manual' | 'none' } = {}) {
  const pendingTransfers: Array<() => void> = []
  const runtime: TransferRuntime = {
    available: true,
    async installProgressListener() {},
    run: () =>
      new Promise<void>(resolve => {
        pendingTransfers.push(resolve)
      }),
  }
  configureTransferRuntime(runtime)

  const verification = {
    started: [] as Array<{ id: string; sessionId: string; remotePath: string }>,
    settle: null as null | (() => void),
    fail: null as null | ((error: Error) => void),
  }

  if (options.verifier === 'none') {
    configureTransferVerifier(null)
  } else {
    configureTransferVerifier((id, args) => {
      verification.started.push({
        id,
        sessionId: args.sessionId,
        remotePath: args.remotePath,
      })
      return new Promise<void>((resolve, reject) => {
        verification.settle = resolve
        verification.fail = reject
      })
    })
  }

  return { runtime, pendingTransfers, verification }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

const records = () => useTransferQueue.getState().transfers
const record = (id: string) => records().find(entry => entry.id === id)
async function startUpload(sessionId = 's1'): Promise<string> {
  await uploadFile({
    sessionId,
    localPath: '/tmp/payload.bin',
    remotePath: '/srv/payload.bin',
    bytesTotal: 100,
  })
  await flush()
  const running = records().find(entry => entry.status === 'running')
  if (!running) throw new Error('the upload did not start')
  return running.id
}

beforeEach(() => {
  useTransferQueue.setState({ transfers: [], panelOpen: false })
  __resetTransferQueueForTests()
  __resetProgressListenerForTests()
  __resetVerificationForTests()
  __resetSessionClaimsForTests()
  registerSession('s1')
  vi.clearAllMocks()
})

describe('a finished transfer keeps its session alive until the check ends', () => {
  it('the session is busy while verifying and idle once it settles', async () => {
    const { verification } = install()
    const id = await startUpload()

    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 100, bytesTotal: 100 })
    await flush()

    // Bytes are done — the transfer is over, the record is terminal…
    expect(record(id)!.status).toBe('done')
    // …but the remote file is still being read, so the connection must survive a
    // dock close or a host switch.
    expect(verification.started).toHaveLength(1)
    expect(hasClaimsForSession('s1')).toBe(true)
    expect(isSessionIdle('s1')).toBe(false)

    verification.settle!()
    await flush()

    expect(hasClaimsForSession('s1')).toBe(false)
    expect(isSessionIdle('s1')).toBe(true)
    expect(claimCountForSession('s1')).toBe(0)
  })

  it('verification does not hold a transfer slot', async () => {
    // Four transfers, limit three: the fourth starts as soon as a slot frees, which
    // happens at `done` — not when the hash finishes.
    const { pendingTransfers, verification } = install()
    await Promise.all(
      Array.from({ length: 4 }, (_, index) =>
        uploadFile({
          sessionId: 's1',
          localPath: `/tmp/file-${index}.bin`,
          remotePath: `/srv/file-${index}.bin`,
        }),
      ),
    )
    await flush()
    expect(pendingTransfers).toHaveLength(3)
    expect(records().filter(entry => entry.status === 'queued')).toHaveLength(1)

    const first = records().find(entry => entry.status === 'running')!
    handleProgressEvent({
      transferId: first.id,
      kind: 'done',
      bytesDone: 10,
      bytesTotal: 10,
    })
    await flush()

    // The queued file got the freed slot while the first one is still hashing.
    expect(pendingTransfers).toHaveLength(4)
    expect(records().filter(entry => entry.status === 'running')).toHaveLength(3)
    expect(verification.started).toHaveLength(1)
  })

  it('a verifier that throws marks the check indeterminate instead of leaving it computing', async () => {
    const { verification } = install()
    const id = await startUpload()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 100, bytesTotal: 100 })
    await flush()

    verification.fail!(new Error('sftp channel closed'))
    await flush()

    const verdict = checksumVerdict(record(id))
    expect(verdict.verdict).toBe('indeterminate')
    expect(verdict.error).toBe('sftp channel closed')
    // And the claim it took is released — a throw must not strand the connection.
    expect(hasClaimsForSession('s1')).toBe(false)
  })

  it('a session that is already closing yields an indeterminate check, never a mismatch', async () => {
    // The transfer finished seconds before the user closed the dock. Reading the
    // remote file is no longer possible; that says nothing about the bytes.
    const { verification } = install()
    const id = await startUpload()
    const { beginSessionClose } = await import('./sftp-session-claim')
    beginSessionClose('s1')

    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 100, bytesTotal: 100 })
    await flush()

    const verdict = checksumVerdict(record(id))
    expect(verdict.verdict).toBe('indeterminate')
    expect(verdict.failedSide).toBe('remote')
    expect(verification.started).toHaveLength(0)
  })

  it('the check reads the session it was admitted with, not whichever is current', async () => {
    /*
     * Two hosts, two sessions. The second transfer is admitted to `s2`; switching the
     * dock to `s1` afterwards must not make the check read `s1`'s file. The verifier
     * receives the args the transfer was created with, so a stale host cannot be
     * hashed into a fresh record.
     */
    registerSession('s2')
    const { pendingTransfers, verification } = install()

    await startUpload('s1')
    await downloadFile({
      sessionId: 's2',
      remotePath: '/srv/other.bin',
      localPath: '/tmp/other.bin',
      bytesTotal: 50,
    })
    await flush()
    expect(pendingTransfers).toHaveLength(2)

    const second = records().find(entry => entry.sessionId === 's2')!
    handleProgressEvent({
      transferId: second.id,
      kind: 'done',
      bytesDone: 50,
      bytesTotal: 50,
    })
    await flush()

    expect(verification.started).toHaveLength(1)
    expect(verification.started[0].sessionId).toBe('s2')
    expect(verification.started[0].remotePath).toBe('/srv/other.bin')
  })

  it('the claim is taken against the transfer session even if another one is idle', async () => {
    registerSession('s2')
    const { verification } = install()
    const id = await startUpload('s1')
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 100, bytesTotal: 100 })
    await flush()

    expect(isSessionIdle('s2')).toBe(true)
    expect(isSessionIdle('s1')).toBe(false)

    verification.settle!()
    await flush()
    expect(isSessionIdle('s1')).toBe(true)
  })
})
