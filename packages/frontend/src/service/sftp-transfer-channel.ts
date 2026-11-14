/**
 * The backend channel: runtime selection, the progress listener, and the event
 * entry point.
 *
 * Split out of `sftp-transfer.ts` along a seam that was already there — that file's
 * header has always described itself as "后端执行端 + 监听器初始化 + API", and the
 * third part is what the ordering work needed room to grow. Keeping the channel
 * here means `sftp-transfer.ts` can be read as one thing: how a transfer is
 * admitted, claimed and scheduled.
 *
 * Every export name is unchanged, so callers and tests keep importing from
 * `sftp-transfer` — it re-exports this module.
 */
import { useTransferQueue } from '@/store/transfer-queue'
import { notify } from '@/service/notifications'
import {
  applyProgress,
  completeTransfer,
  failTransfer,
  transferDisplayName,
} from './sftp-transfer-queue'
import type { SftpProgressPayload, TransferArgs } from './sftp-transfer-types'

function detectTauri(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI_INVOKE__' in window
}

/** 后端执行端：默认实现走 Tauri IPC，测试注入假实现 */
export interface TransferRuntime {
  /** 是否存在需要监听 sftp-progress 的后端事件源 */
  available: boolean
  /** 安装进度监听器；失败必须抛出，不得静默 */
  installProgressListener(
    handler: (payload: SftpProgressPayload) => void,
  ): Promise<void>
  /** 发起后端传输；resolve 表示后端成功完成 */
  run(id: string, args: TransferArgs): Promise<void>
}

const defaultRuntime: TransferRuntime = {
  get available() {
    return detectTauri()
  },
  async installProgressListener(handler) {
    const { listen } = await import('@tauri-apps/api/event')
    await listen<SftpProgressPayload>('sftp-progress', event =>
      handler(event.payload),
    )
  },
  async run(id, args) {
    const { invoke } = await import('@tauri-apps/api/core')
    const target = { transferId: id, sessionId: args.sessionId }
    if (args.kind === 'upload') {
      await invoke('sftp_upload', {
        ...target,
        localPath: args.localPath,
        remotePath: args.remotePath,
      })
    } else {
      await invoke('sftp_download', {
        ...target,
        remotePath: args.remotePath,
        localPath: args.localPath,
      })
    }
  },
}

let runtime: TransferRuntime = defaultRuntime

export function configureTransferRuntime(next: TransferRuntime | null): void {
  runtime = next ?? defaultRuntime
}

/** The runtime in force. Used by the admission path to decide what "available" means. */
export function currentRuntime(): TransferRuntime {
  return runtime
}

// ---------------------------------------------------------------------------
// sftp-progress 监听器：单个 Promise 做并发初始化
// ---------------------------------------------------------------------------

let listenerPromise: Promise<boolean> | null = null
let listenerError: string | null = null

export function getProgressListenerError(): string | null {
  return listenerError
}

async function installProgressListener(): Promise<boolean> {
  try {
    await runtime.installProgressListener(handleProgressEvent)
    listenerError = null
    return true
  } catch (error) {
    listenerError = error instanceof Error ? error.message : String(error)
    listenerPromise = null // 允许下次重试，但绝不静默
    console.warn('[sftp-transfer] failed to install progress listener', error)
    return false
  }
}

/** 幂等初始化：并发调用共享同一个 Promise，不会重复建监听器 */
export function ensureProgressListener(): Promise<boolean> {
  if (!runtime.available) return Promise.resolve(true)
  if (!listenerPromise) listenerPromise = installProgressListener()
  return listenerPromise
}

export function __resetProgressListenerForTests(): void {
  listenerPromise = null
  listenerError = null
}

/** 后端事件入口：重复/乱序/迟到事件由队列管理器的状态机过滤 */
export function handleProgressEvent(payload: SftpProgressPayload): void {
  const store = useTransferQueue.getState()
  switch (payload.kind) {
    case 'progress':
      applyProgress(payload.transferId, payload.bytesDone, payload.bytesTotal)
      return
    case 'done':
      completeTransfer(payload.transferId, payload.bytesDone, payload.bytesTotal)
      return
    case 'error':
      failTransfer(payload.transferId, payload.message ?? 'Transfer failed')
      return
    case 'checksum-start':
      store.initChecksum(payload.transferId)
      return
    case 'checksum-progress':
      store.updateChecksumProgress(
        payload.transferId,
        payload.bytesDone,
        payload.bytesTotal,
      )
      return
    case 'checksum-done':
      store.setChecksumResult(
        payload.transferId,
        payload.side === 'local' ? 'local' : 'remote',
        { success: true, hash: payload.message ?? undefined },
      )
      return
    default:
      return
  }
}

/**
 * Blocked-transfer record: a visible failure plus a notification.
 *
 * Both blocked reasons — the listener could not be installed, and the session is
 * closing — produce exactly this shape, so a user sees one kind of message for
 * "your transfer did not start" rather than two.
 */
export function recordBlockedTransfer(args: TransferArgs, reason: string): void {
  const id = useTransferQueue.getState().enqueue(
    {
      id: '',
      kind: args.kind,
      name: transferDisplayName(args),
      localPath: args.localPath,
      remotePath: args.remotePath,
      sessionId: args.sessionId,
      bytesTotal: args.bytesTotal,
    },
    true,
  )
  failTransfer(id, reason)
  void notify({
    title: `Transfer blocked · ${transferDisplayName(args)}`,
    body: reason,
    type: 'error',
  })
}

/** 监听器装不上时把传输记为明确失败，绝不让它静默地失去事件反馈 */
export async function prepareChannel(args: TransferArgs): Promise<boolean> {
  if (runtime.available && (await ensureProgressListener())) return true
  const reason = runtime.available
    ? `Transfer event listener unavailable: ${listenerError ?? 'unknown error'}`
    : 'Tauri runtime not available'
  recordBlockedTransfer(args, reason)
  return false
}
