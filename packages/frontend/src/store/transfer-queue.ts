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
export type ChecksumStatus = 'pending' | 'computing' | 'done' | 'error'

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
  /**
   * 传输后完整性校验的状态。
   *
   * **没有 `matches`**：`matches: undefined` 有歧义 —— 它既表示「还没算完」，也
   * 表示「一侧算失败」。两个都算成功且不相等才是 mismatch，两个都成功且相等才是
   * verified，其余一律是「未验证」。判定放在 `checksumVerdict()` 里，是一个从
   * 这两个状态推导出来的纯函数，而不是第三个可以与之不一致的字段。
   *
   * **没有 `bytesDone` / `bytesTotal`**：校验进度曾经直接写进传输记录的同名字段，
   * 于是 100 MiB 传完之后一次 20 MiB 的校验会把 UI 报成「20 MB / 100 MB，80%」。
   * 校验有自己的体积，与已完成的文件字节无关，见 `checksumDone` / `checksumTotal`。
   */
  checksum?: {
    algorithm: ChecksumAlgorithm
    localHash?: string
    remoteHash?: string
    localStatus: ChecksumStatus
    remoteStatus: ChecksumStatus
    localError?: string
    remoteError?: string
    /** 远端一侧的校验进度（SHA-256 流式读取），与传输字节分开统计 */
    bytesDone?: number
    bytesTotal?: number
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
  /**
   * 初始化 checksum 状态。
   *
   * `side` 是刚刚开始计算的那一侧（Rust 的 `checksum-start` 事件携带它）。省略时表示
   * 「按传输方向推断」，即把未定论的一侧置为 computing。
   */
  initChecksum: (id: string, side?: 'local' | 'remote') => void
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

  initChecksum(id, side) {
    set(state => ({
      transfers: state.transfers.map(t => {
        if (t.id !== id) return t
        /*
         * ## Initialise, do not reset
         *
         * Both Rust commands emit `checksum-start`, and the channel answers each one
         * with this call. `verifyChecksum` runs them in sequence — local first, then
         * remote — so the *remote* command's start event arrives after the local hash
         * has already been recorded. Rebuilding the object from scratch here reset
         * `localStatus` from `done` back to `pending`, and nothing ever set it again:
         * `checksum-progress` carries only the remote side.
         *
         * The result was a verdict stuck on `computing` for ever. Measured in e2e-06:
         * a 3 MiB upload's check stopped at 85% and did not move across 30 s of
         * sampling.
         *
         * A side that already has an outcome keeps it. A side with no outcome is
         * (re)initialised, which is what lets the UI show progress for it at all.
         */
        const previous = t.checksum
        const settled = (status: ChecksumStatus | undefined) =>
          status === 'done' || status === 'error'

        // A side this event names is *starting*; a side it does not name is left as
        // it was, or pending when nothing has happened to it yet.
        const starting = (which: 'local' | 'remote'): ChecksumStatus => {
          const key = which === 'local' ? 'localStatus' : 'remoteStatus'
          if (settled(previous?.[key])) return previous![key]!
          if (side !== undefined) return side === which ? 'computing' : 'pending'
          // No side named: the direction of the transfer decides which one runs first.
          const first = t.kind === 'download' ? 'remote' : 'local'
          return which === first ? 'computing' : 'pending'
        }
        const localStatus = starting('local')
        const remoteStatus = starting('remote')

        return {
          ...t,
          checksum: {
            ...previous,
            algorithm: 'sha256',
            localStatus,
            remoteStatus,
          },
        }
      }),
    }))
  },

  updateChecksumProgress(id, bytesDone, bytesTotal) {
    set(state => ({
      transfers: state.transfers.map(t => {
        if (t.id !== id) return t
        if (!t.checksum) return t
        // Deliberately NOT `t.bytesDone`: the transfer has already finished, and its
        // byte count is the file's size. Writing the checksum's own counter over it
        // made a finished 100 MiB upload report "20 MB / 100 MB" while the hash ran.
        return {
          ...t,
          checksum: { ...t.checksum, bytesDone, bytesTotal },
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
        // No comparison is recorded here. The verdict is derived on read
        // (`checksumVerdict`), so it cannot disagree with the two statuses it is
        // supposed to describe — the shape that let `matches: false` stand for
        // "one side errored" as well as "the bytes differ".
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
