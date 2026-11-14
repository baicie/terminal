/**
 * SFTP 传输服务
 *
 * 分层职责：
 * - 本文件：**准入层** —— 一次传输如何被受理、认领会话、移交给队列；
 * - sftp-transfer-channel.ts：后端执行端（Tauri IPC）与 sftp-progress 监听器；
 * - sftp-transfer-queue.ts：状态机、并发槽位预占、取消与移除策略；
 * - sftp-session-claim.ts：会话认领，填补「已请求但尚未入队」的窗口。
 *
 * 并发上限与状态转换由队列管理器统一裁决，本文件不重复判断并发。
 */
import { claimSession } from './sftp-session-claim'
import {
  currentRuntime,
  prepareChannel,
  recordBlockedTransfer,
} from './sftp-transfer-channel'
import { configureTransferRunner, scheduleTransfer } from './sftp-transfer-queue'
import type { TransferArgs } from './sftp-transfer-types'

export {
  MAX_CONCURRENT,
  RUNNING_CANCEL_SUPPORTED,
  cancelTransfer,
  removeTransfer,
  canTransition,
  isTerminalStatus,
  getTransferQueueDiagnostics,
  __resetTransferQueueForTests,
} from './sftp-transfer-queue'
export type {
  TransferCancelResult,
  TransferRemoveResult,
  TransferQueueDiagnostics,
} from './sftp-transfer-queue'
export { verifyChecksum } from './sftp-transfer-checksum'
// The channel lives in its own module for size, not for layering — its exports are
// part of this service's surface and callers import them from here.
export {
  configureTransferRuntime,
  currentRuntime,
  ensureProgressListener,
  getProgressListenerError,
  handleProgressEvent,
  prepareChannel,
  recordBlockedTransfer,
  __resetProgressListenerForTests,
} from './sftp-transfer-channel'
export type { TransferRuntime } from './sftp-transfer-channel'

/** The connection is on its way out; the user has to reopen the folder. */
const CLOSING_REASON =
  'The connection for this transfer is closing; reopen the folder and try again.'

/**
 * The shared body of `uploadFile` / `downloadFile`.
 *
 * The claim is taken **before the first `await`** — `prepareChannel` is an IPC round
 * trip, and the file-picker dialog that usually precedes this call can be much
 * longer. Without it the transfer exists nowhere during that window, so
 * `isSessionIdle()` reports an idle session and a closing dock tears the connection
 * down underneath it.
 *
 * The claim is released in `finally`, **after** `scheduleTransfer()` has put a real
 * `queued` record into the store. Handing over in that order is what makes the
 * transition gapless: for an instant both the claim and the queue record exist,
 * which is safe, whereas releasing first would leave an instant with neither.
 *
 * Every exit releases: the listener failing to install, a throw from `scheduleTransfer`,
 * and the success path all pass through the same `finally`.
 */
async function startTransfer(args: TransferArgs): Promise<void> {
  const claim = claimSession(args.sessionId)
  if (!claim.ok) {
    // A session that is closing must not accept new work. Reported, not ignored:
    // a user who picked a file and saw nothing cannot distinguish that from a
    // successful upload of a zero-byte file.
    recordBlockedTransfer(args, CLOSING_REASON)
    return
  }
  try {
    if (!(await prepareChannel(args))) return
    scheduleTransfer(args)
  } finally {
    claim.release()
  }
}

export async function uploadFile({
  sessionId,
  localPath,
  remotePath,
  displayName,
  bytesTotal,
}: {
  sessionId: string
  localPath: string
  remotePath: string
  displayName?: string
  bytesTotal?: number
}): Promise<void> {
  await startTransfer({
    kind: 'upload',
    sessionId,
    localPath,
    remotePath,
    displayName,
    bytesTotal,
  })
}

export async function downloadFile({
  sessionId,
  remotePath,
  localPath,
  displayName,
  bytesTotal,
}: {
  sessionId: string
  remotePath: string
  localPath: string
  displayName?: string
  bytesTotal?: number
}): Promise<void> {
  await startTransfer({
    kind: 'download',
    sessionId,
    remotePath,
    localPath,
    displayName,
    bytesTotal,
  })
}

/** 批量上传：并发上限由队列管理器强制，超出的任务停留在 queued */
export async function uploadPaths(args: {
  sessionId: string
  remoteDir: string
  localPaths: string[]
}): Promise<void> {
  const { sessionId, remoteDir, localPaths } = args
  const uploads = localPaths.map(localPath => {
    const parts = localPath.split(/[\\/]+/)
    const name = parts[parts.length - 1] || localPath
    const remotePath = `${remoteDir.replace(/\/+$/, '')}/${name}`
    return { localPath, remotePath, name }
  })
  await Promise.allSettled(
    uploads.map(({ localPath, remotePath, name }) =>
      uploadFile({ sessionId, localPath, remotePath, displayName: name }),
    ),
  )
}

// The queue needs a runner; it is the channel's `run`, resolved at call time so a
// runtime installed by a test after this module loads still takes effect.
configureTransferRunner((id, args) => currentRuntime().run(id, args))
