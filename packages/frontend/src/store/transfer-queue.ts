/**
 * 全局 SFTP 传输队列
 *
 * 每条记录独立追踪，由 backend 通过 `sftp-progress` 事件驱动更新。
 * UI 通过 `useTransferQueue` 订阅展示进度面板。
 */
import { create } from 'zustand'

export type TransferKind = 'upload' | 'download'
export type TransferStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled'
export type ChecksumAlgorithm = 'sha256'
export type ChecksumStatus = 'pending' | 'computing' | 'done' | 'error' | 'mismatch'

/** 单侧 checksum 计算结果 */
export interface TransferChecksumResult {
  algorithm: ChecksumAlgorithm
  hash: string
  status: 'computing' | 'done' | 'error'
  error?: string
}

export interface TransferRecord {
  id: string
  kind: TransferKind
  /** 友好显示名（文件名） */
  name: string
  /** 本地路径 */
  localPath: string
  /** 远端路径 */
  remotePath: string
  /** 关联的 SSH session id */
  sessionId: string
  status: TransferStatus
  bytesDone: number
  bytesTotal: number
  /** 速度估算（字节/秒），客户端基于上次进度回调时间窗口算 */
  speed: number
  /** 错误消息（status=error 时） */
  message?: string
  startedAt: number
  finishedAt?: number
  /** 上一次速度采样的时间戳和字节数（仅内部使用） */
  _prevSampleAt?: number
  _prevSampleBytes?: number
  /** Checksum 状态（传输完成前为 pending，完成后触发校验） */
  checksum?: {
    algorithm: ChecksumAlgorithm
    localHash?: string
    remoteHash?: string
    localStatus: ChecksumStatus
    remoteStatus: ChecksumStatus
    localError?: string
    remoteError?: string
    /** 两端 hash 是否一致 */
    matches?: boolean
  }
}

interface TransferQueueState {
  transfers: TransferRecord[]
  /** UI: 是否展开传输面板 */
  panelOpen: boolean
  enqueue: (
    record: Omit<
      TransferRecord,
      | 'status'
      | 'bytesDone'
      | 'bytesTotal'
      | 'speed'
      | 'startedAt'
      | '_prevSampleAt'
      | '_prevSampleBytes'
    > & { bytesTotal?: number },
    /** 传入 true 时以 queued 状态入队，由调用方控制何时 start */
    startInQueue?: boolean,
  ) => string
  updateProgress: (
    id: string,
    bytesDone: number,
    bytesTotal: number,
  ) => void
  finish: (id: string, status: 'done' | 'error', message?: string) => void
  remove: (id: string) => void
  clearFinished: () => void
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  /** 初始化 checksum 状态（传输完成时调用） */
  initChecksum: (id: string) => void
  /** 更新 checksum 进度（remote checksum 进度） */
  updateChecksumProgress: (id: string, bytesDone: number, bytesTotal: number) => void
  /** 设置 checksum 结果（任一端计算完成时调用） */
  setChecksumResult: (
    id: string,
    side: 'local' | 'remote',
    result: { success: boolean; hash?: string; error?: string },
  ) => void
}

function makeId() {
  return crypto.randomUUID()
}

export const useTransferQueue = create<TransferQueueState>((set, get) => ({
  transfers: [],
  panelOpen: false,

  enqueue(record, startInQueue = false) {
    const id = record.id || makeId()
    const next: TransferRecord = {
      ...record,
      id,
      status: startInQueue ? 'queued' : 'running',
      bytesDone: 0,
      bytesTotal: record.bytesTotal ?? 0,
      speed: 0,
      startedAt: Date.now(),
    }
    set(state => ({
      transfers: [next, ...state.transfers],
      panelOpen: true,
    }))
    return id
  },

  updateProgress(id, bytesDone, bytesTotal) {
    set(state => ({
      transfers: state.transfers.map(t => {
        if (t.id !== id) return t
        const now = Date.now()
        const prevAt = t._prevSampleAt ?? t.startedAt
        const prevBytes = t._prevSampleBytes ?? 0
        const dt = (now - prevAt) / 1000
        const speed = dt > 0 ? Math.max(0, (bytesDone - prevBytes) / dt) : t.speed
        return {
          ...t,
          status: 'running',
          bytesDone,
          bytesTotal: bytesTotal > 0 ? bytesTotal : t.bytesTotal,
          speed,
          _prevSampleAt: now,
          _prevSampleBytes: bytesDone,
        }
      }),
    }))
  },

  finish(id, status, message) {
    set(state => ({
      transfers: state.transfers.map(t =>
        t.id === id
          ? {
              ...t,
              status,
              message,
              finishedAt: Date.now(),
              bytesDone: status === 'done' ? t.bytesTotal || t.bytesDone : t.bytesDone,
            }
          : t,
      ),
    }))
  },

  remove(id) {
    set(state => ({
      transfers: state.transfers.filter(t => t.id !== id),
    }))
  },

  clearFinished() {
    set(state => ({
      transfers: state.transfers.filter(
        t => t.status === 'running' || t.status === 'queued',
      ),
    }))
  },

  setPanelOpen(open) {
    set({ panelOpen: open })
  },

  togglePanel() {
    set({ panelOpen: !get().panelOpen })
  },

  initChecksum(id) {
    set(state => ({
      transfers: state.transfers.map(t =>
        t.id === id
          ? {
              ...t,
              checksum: {
                algorithm: 'sha256',
                localStatus: t.kind === 'download' ? 'pending' : 'computing',
                remoteStatus: t.kind === 'upload' ? 'pending' : 'computing',
              },
            }
          : t,
      ),
    }))
  },

  updateChecksumProgress(id, bytesDone, bytesTotal) {
    set(state => ({
      transfers: state.transfers.map(t => {
        if (t.id !== id) return t
        if (!t.checksum) return t
        return {
          ...t,
          bytesDone,
          bytesTotal,
        }
      }),
    }))
  },

  setChecksumResult(id, side, result) {
    set(state => ({
      transfers: state.transfers.map(t => {
        if (t.id !== id || !t.checksum) return t
        const newChecksum = { ...t.checksum }
        if (side === 'local') {
          newChecksum.localHash = result.hash
          newChecksum.localStatus = result.success ? 'done' : 'error'
          newChecksum.localError = result.error
        } else {
          newChecksum.remoteHash = result.hash
          newChecksum.remoteStatus = result.success ? 'done' : 'error'
          newChecksum.remoteError = result.error
        }
        // Auto-compare if both are done
        if (
          newChecksum.localStatus === 'done' &&
          newChecksum.remoteStatus === 'done' &&
          newChecksum.localHash &&
          newChecksum.remoteHash
        ) {
          newChecksum.matches = newChecksum.localHash === newChecksum.remoteHash
        }
        return { ...t, checksum: newChecksum }
      }),
    }))
  },
}))

// Convenience selectors
export function useActiveTransfers() {
  return useTransferQueue(s =>
    s.transfers.filter(t => t.status === 'running' || t.status === 'queued'),
  )
}
