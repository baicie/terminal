/**
 * SFTP 传输服务
 *
 * 把 backend 的 `sftp_upload` / `sftp_download` 命令封装为带进度的高层 API。
 * 自动维护单一全局 `sftp-progress` 监听器，把事件分发到对应的 transfer 记录。
 *
 * 并发控制：最多 `MAX_CONCURRENT` (3) 个传输同时运行。
 * 超出上限的传输进入排队状态，running 完成后自动出队并启动。
 *
 * Checksum 校验：传输完成后可通过 `verifyChecksum()` 验证完整性。
 */
import { sftpService } from '@/features/terminal/services/sftp'
import { useTransferQueue } from '@/store/transfer-queue'
import { notify } from '@/service/notifications'

interface SftpProgressPayload {
  transferId: string
  kind: 'progress' | 'done' | 'error' | 'checksum-start' | 'checksum-progress' | 'checksum-done'
  bytesDone: number
  bytesTotal: number
  message?: string | null
}

let listenerInstalled = false

function detectTauri(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI_INVOKE__' in window
}

async function ensureListener(): Promise<void> {
  if (listenerInstalled || !detectTauri()) return
  listenerInstalled = true
  try {
    const { listen } = await import('@tauri-apps/api/event')
    await listen<SftpProgressPayload>('sftp-progress', evt => {
      const { transferId, kind, bytesDone, bytesTotal, message } = evt.payload
      const store = useTransferQueue.getState()
      if (kind === 'progress') {
        store.updateProgress(transferId, bytesDone, bytesTotal)
      } else if (kind === 'done') {
        store.updateProgress(transferId, bytesDone, bytesTotal)
        store.finish(transferId, 'done')
        // Concurrent: check if a queued transfer can start now
        queueMicrotask(() => dispatchNext())
      } else if (kind === 'error') {
        store.finish(transferId, 'error', message ?? 'Transfer failed')
        queueMicrotask(() => dispatchNext())
      } else if (kind === 'checksum-start') {
        store.initChecksum(transferId)
      } else if (kind === 'checksum-progress') {
        store.updateChecksumProgress(transferId, bytesDone, bytesTotal)
      } else if (kind === 'checksum-done') {
        // message contains the hex hash for remote side
        store.setChecksumResult(transferId, 'remote', {
          success: true,
          hash: message ?? undefined,
        })
      }
    })
  } catch (e) {
    console.warn('[sftp-transfer] failed to install listener', e)
    listenerInstalled = false
  }
}

// ---------------------------------------------------------------------------
// Concurrent transfer queue
// ---------------------------------------------------------------------------

const MAX_CONCURRENT = 3

type TransferArgs =
  | { kind: 'upload'; sessionId: string; localPath: string; remotePath: string; displayName?: string; bytesTotal?: number }
  | { kind: 'download'; sessionId: string; remotePath: string; localPath: string; displayName?: string; bytesTotal?: number }

/** 追踪每个待处理传输的调用参数，用于并发出队时重新发起 */
const pendingTransfers = new Map<string, TransferArgs>()

function basename(p: string): string {
  const parts = p.split(/[\\/]+/)
  return parts[parts.length - 1] || p
}

function runningCount(): number {
  return useTransferQueue.getState().transfers.filter(t => t.status === 'running').length
}

function dispatchNext(): void {
  if (!detectTauri()) return
  if (runningCount() >= MAX_CONCURRENT) return

  const store = useTransferQueue.getState()
  const queued = store.transfers.find(t => t.status === 'queued')
  if (!queued) return

  const args = pendingTransfers.get(queued.id)
  if (!args) {
    // No args stored — mark as running and skip (shouldn't happen)
    store.updateProgress(queued.id, 0, queued.bytesTotal)
    return
  }

  void startTransfer(queued.id, args)
}

async function startTransfer(id: string, args: TransferArgs): Promise<void> {
  pendingTransfers.delete(id)

  const { invoke } = await import('@tauri-apps/api/core')
  const notifyName = args.kind === 'upload'
    ? args.displayName ?? basename(args.localPath)
    : args.displayName ?? basename(args.remotePath)

  try {
    if (args.kind === 'upload') {
      await invoke('sftp_upload', {
        transferId: id,
        sessionId: args.sessionId,
        localPath: args.localPath,
        remotePath: args.remotePath,
      })
    } else {
      await invoke('sftp_download', {
        transferId: id,
        sessionId: args.sessionId,
        remotePath: args.remotePath,
        localPath: args.localPath,
      })
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    useTransferQueue.getState().finish(id, 'error', msg)
    void notify({
      title: `${args.kind === 'upload' ? 'Upload' : 'Download'} failed · ${notifyName}`,
      body: msg,
      type: 'error',
    })
  }

  queueMicrotask(() => dispatchNext())
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
  await ensureListener()
  const store = useTransferQueue.getState()
  const name = displayName ?? basename(localPath)

  const id = store.enqueue({
    id: '',
    kind: 'upload',
    name,
    localPath,
    remotePath,
    sessionId,
    bytesTotal,
  }, true) // always start in queued; dispatchNext starts it if room available

  if (!detectTauri()) {
    store.finish(id, 'error', 'Tauri runtime not available')
    return
  }

  pendingTransfers.set(id, { kind: 'upload', sessionId, localPath, remotePath, displayName, bytesTotal })

  // If at concurrency limit, the record is already queued from the first enqueue call.
  // dispatchNext() will start it when a slot frees.
  if (runningCount() < MAX_CONCURRENT) {
    void startTransfer(id, { kind: 'upload', sessionId, localPath, remotePath, displayName, bytesTotal })
  }
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
  await ensureListener()
  const store = useTransferQueue.getState()
  const name = displayName ?? basename(remotePath)

  const id = store.enqueue({
    id: '',
    kind: 'download',
    name,
    localPath,
    remotePath,
    sessionId,
    bytesTotal,
  }, true)

  if (!detectTauri()) {
    store.finish(id, 'error', 'Tauri runtime not available')
    return
  }

  pendingTransfers.set(id, { kind: 'download', sessionId, remotePath, localPath, displayName, bytesTotal })

  if (runningCount() < MAX_CONCURRENT) {
    void startTransfer(id, { kind: 'download', sessionId, remotePath, localPath, displayName, bytesTotal })
  }
}

/**
 * 批量上传（并发最多 MAX_CONCURRENT 个）。
 * 超出并发上限的文件自动进入排队状态，running 完成后自动启动。
 */
export async function uploadPaths(args: {
  sessionId: string
  remoteDir: string
  localPaths: string[]
}): Promise<void> {
  const { sessionId, remoteDir, localPaths } = args

  const uploads = localPaths.map(localPath => {
    const name = basename(localPath)
    const remotePath = `${remoteDir.replace(/\/+$/, '')}/${name}`
    return { localPath, remotePath, name }
  })

  // 同时发起所有上传，并发控制由 uploadFile 内部处理
  await Promise.allSettled(
    uploads.map(({ localPath, remotePath, name }) =>
      uploadFile({ sessionId, localPath, remotePath, displayName: name }),
    ),
  )
}

/**
 * 验证传输完整性：对本地文件和远端文件分别计算 SHA-256，
 * 然后比对两端的 hash 值。
 *
 * 调用流程：
 * 1. 本地文件：直接用 Rust 计算本地 checksum
 * 2. 远端文件：Rust SFTP 流式读取计算 checksum，事件通知前端
 * 3. 两端 hash 都在 TransferRecord.checksum 中，自动比对
 *
 * 调用方需要监听 TransferQueue 的变化来获取最终比对结果。
 */
export async function verifyChecksum(args: {
  transferId: string
  sessionId: string
  localPath: string
  remotePath: string
}): Promise<void> {
  const { transferId, sessionId, localPath, remotePath } = args

  // 初始化 checksum 状态
  useTransferQueue.getState().initChecksum(transferId)

  // 并行计算本地和远端 hash
  const [localResult] = await Promise.all([
    // 本地 checksum：直接调用 Rust
    sftpService.checksumLocal(transferId, localPath),
  ])

  // 本地结果立即写入
  useTransferQueue.getState().setChecksumResult(transferId, 'local', {
    success: localResult.success,
    hash: localResult.hash,
    error: localResult.message,
  })

  // 远端 checksum：通过 SFTP 流式读取，进度通过事件通知
  // 必须用原始 transferId 以便事件监听器匹配
  const remoteResult = await sftpService.checksumRemote(
    transferId,
    sessionId,
    remotePath,
  )

  useTransferQueue.getState().setChecksumResult(transferId, 'remote', {
    success: remoteResult.success,
    hash: remoteResult.hash,
    error: remoteResult.message,
  })
}
