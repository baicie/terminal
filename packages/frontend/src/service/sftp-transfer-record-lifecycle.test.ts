/**
 * T15 — 记录在 verifying 阶段被移除、清空、切 Host 时的行为。
 *
 * ## 三个问题，都不该靠读代码回答
 *
 * 1. **用户可以移除正在校验的记录吗？** `removeTransfer` 只看 `status`，而校验发生在
 *    `done` 之后 —— 记录已经是终态，所以答案是「可以」。那之后校验的结果去哪了？
 * 2. **`clearFinished` 会清掉它吗？** 同理。
 * 3. **会话 claim 会泄漏吗？** 记录没了，但校验持有的 claim 必须照常释放。
 *
 * ## 产品语义（本文件钉住的那一条）
 *
 * 用户可以隐藏一条记录 —— 那是他的界面。但**校验不能因此被静默中断，也不能因此
 * 误报成功**：
 *
 *   - 结果写进已删除的记录 = 什么都没发生（无害，但也不能声称验证过）；
 *   - claim 必须释放（否则关闭 Dock 会永远等一条不存在的校验）；
 *   - 一条被移除的记录不能留下 `verifyingIds` 里的孤儿。
 *
 * 运行中取消后端不支持 —— 本文件**不**断言任何「取消成功」，因为那是假的。
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
import { removeTransfer } from './sftp-transfer-controls'
import {
  __resetProgressListenerForTests,
  configureTransferRuntime,
  handleProgressEvent,
  uploadFile,
  type TransferRuntime,
} from './sftp-transfer'
import {
  __resetTransferQueueForTests,
  getTransferQueueDiagnostics,
} from './sftp-transfer-queue'
import {
  __resetVerificationForTests,
  configureTransferVerifier,
} from './sftp-transfer-verify'

interface Harness {
  settleTransfer: (index: number) => void
  finishVerification: () => void
  failVerification: (error: Error) => void
  started: number
}

function install(): Harness {
  const setters: Array<() => void> = []
  let resolveVerification: (() => void) | null = null
  let rejectVerification: ((error: Error) => void) | null = null
  let started = 0

  const runtime: TransferRuntime = {
    available: true,
    async installProgressListener() {},
    run: () =>
      new Promise<void>(resolve => {
        setters.push(resolve)
      }),
  }
  configureTransferRuntime(runtime)
  configureTransferVerifier(() => {
    started += 1
    return new Promise<void>((resolve, reject) => {
      resolveVerification = resolve
      rejectVerification = reject
    })
  })

  return {
    settleTransfer: index => setters[index]?.(),
    finishVerification: () => resolveVerification?.(),
    failVerification: error => rejectVerification?.(error),
    get started() {
      return started
    },
  }
}

async function flush(times = 16) {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

const records = () => useTransferQueue.getState().transfers
const record = (id: string) => records().find(entry => entry.id === id)

async function doneTransfer(): Promise<string> {
  await uploadFile({
    sessionId: 's1',
    localPath: '/tmp/payload.bin',
    remotePath: '/srv/payload.bin',
    bytesTotal: 1024,
  })
  await flush()
  const id = records().find(entry => entry.status === 'running')!.id
  return id
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

describe('T15 — hiding a record must not silently cancel its check', () => {
  it('a record can be removed while its check is running, and the claim survives', async () => {
    /*
     * The record is `done` (terminal), so `removeTransfer` accepts it even though the
     * integrity check is still reading the remote file. That is the current behaviour
     * and it is reasonable: the queue's `active` guard is about *transfers*, and this
     * one has finished.
     *
     * What must hold regardless: the check still owns its session. If removing the row
     * released the claim, closing the dock would tear the connection down under a
     * remote read that is still in flight.
     */
    const harness = install()
    const id = await doneTransfer()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await flush()
    expect(harness.started).toBe(1)
    expect(hasClaimsForSession('s1')).toBe(true)

    expect(removeTransfer(id)).toEqual({ ok: true })
    expect(record(id)).toBeUndefined()
    // Still busy: the check has not finished.
    expect(hasClaimsForSession('s1')).toBe(true)
    expect(isSessionIdle('s1')).toBe(false)

    harness.finishVerification()
    await flush(24)
    expect(hasClaimsForSession('s1')).toBe(false)
    expect(claimCountForSession('s1')).toBe(0)
  })

  it('the check still completes for a removed record, and writes nowhere', async () => {
    /*
     * `setChecksumResult` is a no-op for an id it cannot find — so the result is simply
     * dropped. That is the honest outcome of "the user hid the row": nothing claims
     * verified, and nothing claims a mismatch either.
     *
     * The alternative — resurrecting the record so the result can land — would put a row
     * back on a panel the user just cleared.
     */
    const harness = install()
    const id = await doneTransfer()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await flush()
    removeTransfer(id)
    harness.finishVerification()
    await flush(24)

    expect(record(id)).toBeUndefined()
    // No ghost record was created to hold the result.
    expect(records()).toHaveLength(0)
    // And the queue has no orphan tracking it.
    expect(getTransferQueueDiagnostics().verifyingIds).toHaveLength(0)
  })

  it('clearFinished removes a verifying record without leaking its tracking', async () => {
    // `clearFinished` keeps `running` and `queued`; a verifying record is `done`, so it
    // is cleared too. The same invariants as `removeTransfer` apply.
    const harness = install()
    const id = await doneTransfer()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await flush()
    expect(getTransferQueueDiagnostics().verifyingIds).toContain(id)

    useTransferQueue.getState().clearFinished()
    expect(record(id)).toBeUndefined()
    // The check is still running in the background; its claim must not be released
    // early just because the row is gone.
    expect(hasClaimsForSession('s1')).toBe(true)

    harness.finishVerification()
    await flush(24)
    expect(getTransferQueueDiagnostics().verifyingIds).toHaveLength(0)
    expect(hasClaimsForSession('s1')).toBe(false)
  })

  it('a verification error on a removed record does not resurrect it', async () => {
    // The throw path also writes to a record that may be gone. It must not create one,
    // and it must still release the claim.
    const harness = install()
    const id = await doneTransfer()
    handleProgressEvent({ transferId: id, kind: 'done', bytesDone: 1024, bytesTotal: 1024 })
    await flush()
    removeTransfer(id)

    harness.failVerification(new Error('channel closed'))
    await flush(24)

    expect(record(id)).toBeUndefined()
    expect(hasClaimsForSession('s1')).toBe(false)
  })

  it('a second transfer is unaffected by the first one being removed mid-check', async () => {
    // The queue must keep moving: removing a verifying row cannot leave a slot or a
    // pending argument behind.
    const harness = install()
    const firstId = await doneTransfer()
    handleProgressEvent({
      transferId: firstId,
      kind: 'done',
      bytesDone: 1024,
      bytesTotal: 1024,
    })
    await flush()
    removeTransfer(firstId)

    const secondId = await doneTransfer()
    expect(record(secondId)!.status).toBe('running')
    expect(getTransferQueueDiagnostics().runningSlotIds).toEqual([secondId])

    harness.finishVerification()
    harness.settleTransfer(1)
    await flush(24)
  })

  it('the running-transfer cancel is still refused, not faked', async () => {
    /*
     * The task says it explicitly: "运行中取消后端目前不支持，不得伪造取消成功". This
     * pins that the UI's refusal is the product's answer, so a future "improvement"
     * that returns ok cannot pass silently. Kept in this file because "lifecycle of a
     * transfer record" is exactly where a fake cancel would land.
     */
    const { cancelTransfer } = await import('./sftp-transfer-controls')
    await uploadFile({
      sessionId: 's1',
      localPath: '/tmp/x.bin',
      remotePath: '/srv/x.bin',
      bytesTotal: 1024,
    })
    await flush()
    const id = records().find(entry => entry.status === 'running')!.id

    expect(cancelTransfer(id)).toEqual({
      ok: false,
      reason: 'unsupported-running',
    })
    expect(record(id)!.status).toBe('running')
  })

  it('switching hosts mid-check does not move the result to another record', async () => {
    /*
     * A host switch is a UI action; the check holds its own `sessionId` and the record
     * holds its own id. Nothing about the switch can redirect a result — asserted here
     * because "the dock now shows host B" is exactly when a mis-keyed write would be
     * hardest to notice.
     */
    registerSession('s2')
    const harness = install()
    const firstId = await doneTransfer()
    handleProgressEvent({
      transferId: firstId,
      kind: 'done',
      bytesDone: 1024,
      bytesTotal: 1024,
    })
    await flush()

    // A second transfer on the other host, still running.
    await uploadFile({
      sessionId: 's2',
      localPath: '/tmp/other.bin',
      remotePath: '/srv/other.bin',
      bytesTotal: 512,
    })
    await flush()
    const secondId = records().find(
      entry => entry.status === 'running' && entry.sessionId === 's2',
    )!.id

    harness.finishVerification()
    await flush(24)

    // The first record's check concluded; the second record has no checksum at all.
    expect(checksumVerdict(record(firstId)).verdict).not.toBe('computing')
    expect(record(secondId)!.checksum).toBeUndefined()
  })
})
