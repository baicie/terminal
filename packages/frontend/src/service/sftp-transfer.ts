/**
 * SFTP 传输服务
 *
 * 把 backend 的 `sftp_upload` / `sftp_download` 命令封装为带进度的高层 API。
 * 自动维护单一全局 `sftp-progress` 监听器，把事件分发到对应的 transfer 记录。
 */
import { useTransferQueue } from '@/store/transfer-queue'
import { notify } from '@/service/notifications'

interface SftpProgressPayload {
  transferId: string
  kind: 'progress' | 'done' | 'error'
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
      } else if (kind === 'error') {
        store.finish(transferId, 'error', message ?? 'Transfer failed')
      }
    })
  } catch (e) {
    console.warn('[sftp-transfer] failed to install listener', e)
    listenerInstalled = false
  }
}

interface UploadArgs {
  sessionId: string
  localPath: string
  remotePath: string
  /** 友好显示名（默认从 localPath 提取 basename） */
  displayName?: string
  /** 文件大小（字节）— 可选，前端可在 enqueue 时显示总大小 */
  bytesTotal?: number
}

interface DownloadArgs {
  sessionId: string
  remotePath: string
  localPath: string
  displayName?: string
  bytesTotal?: number
}

function basename(p: string): string {
  const parts = p.split(/[\\/]+/)
  return parts[parts.length - 1] || p
}

export async function uploadFile({
  sessionId,
  localPath,
  remotePath,
  displayName,
  bytesTotal,
}: UploadArgs): Promise<void> {
  await ensureListener()
  const store = useTransferQueue.getState()
  const id = store.enqueue({
    id: '', // store will generate
    kind: 'upload',
    name: displayName || basename(localPath),
    localPath,
    remotePath,
    sessionId,
    bytesTotal,
  })

  if (!detectTauri()) {
    store.finish(id, 'error', 'Tauri runtime not available')
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('sftp_upload', {
      transferId: id,
      sessionId,
      localPath,
      remotePath,
    })
    // backend will emit `done`; if it doesn't (legacy path) ensure done state
    setTimeout(() => {
      const cur = useTransferQueue
        .getState()
        .transfers.find(t => t.id === id)
      if (cur && cur.status === 'running') {
        useTransferQueue.getState().finish(id, 'done')
      }
    }, 250)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    store.finish(id, 'error', msg)
    void notify({
      title: `Upload failed · ${displayName || basename(localPath)}`,
      body: msg,
      type: 'error',
    })
    throw e
  }
}

export async function downloadFile({
  sessionId,
  remotePath,
  localPath,
  displayName,
  bytesTotal,
}: DownloadArgs): Promise<void> {
  await ensureListener()
  const store = useTransferQueue.getState()
  const id = store.enqueue({
    id: '',
    kind: 'download',
    name: displayName || basename(remotePath),
    localPath,
    remotePath,
    sessionId,
    bytesTotal,
  })

  if (!detectTauri()) {
    store.finish(id, 'error', 'Tauri runtime not available')
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('sftp_download', {
      transferId: id,
      sessionId,
      remotePath,
      localPath,
    })
    setTimeout(() => {
      const cur = useTransferQueue
        .getState()
        .transfers.find(t => t.id === id)
      if (cur && cur.status === 'running') {
        useTransferQueue.getState().finish(id, 'done')
      }
    }, 250)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    store.finish(id, 'error', msg)
    void notify({
      title: `Download failed · ${displayName || basename(remotePath)}`,
      body: msg,
      type: 'error',
    })
    throw e
  }
}

/**
 * 批量上传（顺序，避免单 SFTP session 上的并发冲突）。
 *
 * 接受真实的本地文件路径列表（来自 Tauri 拖放事件 `tauri://drag-drop` 或
 * 文件选择器 `dialog.open`）。这样可以零拷贝调用后端 chunked 上传。
 */
export async function uploadPaths(args: {
  sessionId: string
  remoteDir: string
  localPaths: string[]
}): Promise<void> {
  const { sessionId, remoteDir, localPaths } = args
  for (const localPath of localPaths) {
    const name = basename(localPath)
    const remotePath = `${remoteDir.replace(/\/+$/, '')}/${name}`
    try {
      await uploadFile({
        sessionId,
        localPath,
        remotePath,
        displayName: name,
      })
    } catch (e) {
      console.warn('[sftp-transfer] uploadPaths failed for', localPath, e)
    }
  }
}
