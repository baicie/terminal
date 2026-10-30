/**
 * SFTP 传输队列管理器 —— 状态机与并发控制的唯一收口点
 *
 * 状态机（唯一定义在 ALLOWED_TRANSITIONS）：
 *   queued → running → done / error
 *   queued → cancelled        （取消排队任务，纯前端即可兑现）
 *   queued → error            （参数缺失等明确失败）
 * 运行中任务**没有** cancelling / cancelled 转换：Rust 侧 sftp_upload /
 * sftp_download 没有取消命令（见 sftp.rs），伪造取消会破坏并发统计与真实状态。
 *
 * 并发不变式：runningSlots 是运行槽位的唯一真值来源，在**任何 await 之前**同步预占，
 * 所以短时间连续提交也无法突破 MAX_CONCURRENT；store 只用于渲染，不参与限流判断。
 */
import {
  useTransferQueue,
  type TransferRecord,
  type TransferStatus,
} from '@/store/transfer-queue'
import { notify } from '@/service/notifications'
import type { TransferArgs } from './sftp-transfer-types'

export const MAX_CONCURRENT = 3

/** 后端是否具备真实取消能力：Rust 侧无 cancel 命令，故运行中任务不可取消 */
export const RUNNING_CANCEL_SUPPORTED = false

/** 合法状态转换表 —— 状态机的唯一定义 */
const ALLOWED_TRANSITIONS: Record<TransferStatus, readonly TransferStatus[]> = {
  queued: ['running', 'cancelled', 'error'],
  running: ['done', 'error'],
  done: [],
  error: [],
  cancelled: [],
}

export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export function isTerminalStatus(status: TransferStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0
}

/** 后端传输执行端；由 sftp-transfer.ts 注入，测试注入假实现 */
export type TransferRunner = (id: string, args: TransferArgs) => Promise<void>

const unconfiguredRunner: TransferRunner = () =>
  Promise.reject(new Error('SFTP transfer runner is not configured'))

let runner: TransferRunner = unconfiguredRunner

export function configureTransferRunner(next: TransferRunner | null): void {
  runner = next ?? unconfiguredRunner
}

/** 运行槽位：同步预占，不受异步间隙影响 */
const runningSlots = new Set<string>()
/** 已经启动过的 transferId：同一个 id 最多启动一次 */
const startedIds = new Set<string>()
/** 待调度参数；不变式：key ⊆ queued ∪ running 对应的记录 */
const pendingArgs = new Map<string, TransferArgs>()

let dispatching = false
let redispatchNeeded = false

function findRecord(id: string): TransferRecord | undefined {
  return useTransferQueue.getState().transfers.find(t => t.id === id)
}

/** 唯一的状态写入点：非法转换直接拒绝，绝不半途改 store */
function transition(
  id: string,
  to: TransferStatus,
  patch: Partial<TransferRecord> = {},
): boolean {
  const record = findRecord(id)
  if (!record || !canTransition(record.status, to)) return false
  const finishedAt = isTerminalStatus(to) ? Date.now() : undefined
  useTransferQueue.setState(state => ({
    transfers: state.transfers.map(t =>
      t.id === id ? { ...t, ...patch, status: to, ...(finishedAt ? { finishedAt } : {}) } : t,
    ),
  }))
  return true
}

/**
 * 释放槽位与参数（幂等）。
 * 即使记录已被 UI 移除也必须释放，否则关闭页面再进入会永久泄漏槽位。
 */
function settle(id: string): void {
  runningSlots.delete(id)
  pendingArgs.delete(id)
}

export function transferDisplayName(args: TransferArgs): string {
  const raw =
    args.displayName ?? (args.kind === 'upload' ? args.localPath : args.remotePath)
  const parts = raw.split(/[\\/]+/)
  return parts[parts.length - 1] || raw
}

function notifyFailure(args: TransferArgs, message: string): void {
  const label = args.kind === 'upload' ? 'Upload' : 'Download'
  void notify({ title: `${label} failed · ${transferDisplayName(args)}`, body: message, type: 'error' })
}

/** 进度事件：只接受 running 记录，迟到的/重复的/未知的 id 一律忽略 */
export function applyProgress(id: string, bytesDone: number, bytesTotal: number): boolean {
  const record = findRecord(id)
  if (!record || record.status !== 'running') return false
  useTransferQueue.getState().updateProgress(id, bytesDone, bytesTotal)
  return true
}

/** 完成：幂等，重复 finish 与迟到事件都不会二次释放槽位或覆盖终态 */
export function completeTransfer(
  id: string,
  bytesDone?: number,
  bytesTotal?: number,
): boolean {
  const record = findRecord(id)
  const applied = record
    ? transition(id, 'done', {
        bytesDone: bytesTotal || bytesDone || record.bytesTotal || record.bytesDone,
        bytesTotal: bytesTotal || record.bytesTotal,
      })
    : false
  settle(id)
  dispatch() // 槽位可能已释放：即使记录被 UI 移除也要继续推进队列
  return applied
}

/** 失败：running → error 或 queued → error（参数缺失等），同样幂等 */
export function failTransfer(id: string, message: string): boolean {
  const applied = transition(id, 'error', { message })
  settle(id)
  dispatch()
  return applied
}

/** 队列中最久的一个待启动记录（store 头插，故从尾部向前找 = FIFO） */
function nextQueued(skip: Set<string>): TransferRecord | undefined {
  const { transfers } = useTransferQueue.getState()
  for (let index = transfers.length - 1; index >= 0; index -= 1) {
    const record = transfers[index]
    if (record.status === 'queued' && !skip.has(record.id)) return record
  }
  return undefined
}

function startRun(id: string, args: TransferArgs): void {
  const fail = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    if (failTransfer(id, message)) notifyFailure(args, message)
  }
  // Promise.resolve() 让 runner 的同步抛错也走同一个失败分支
  void Promise.resolve()
    .then(() => runner(id, args))
    .then(() => completeTransfer(id), fail)
}

function pump(): void {
  const attempted = new Set<string>()
  while (runningSlots.size < MAX_CONCURRENT) {
    const next = nextQueued(attempted)
    if (!next) return
    attempted.add(next.id)

    const args = pendingArgs.get(next.id)
    if (!args) {
      // 参数缺失：明确失败并诊断，绝不把任务标成永久假 running
      failTransfer(next.id, `Missing transfer arguments for ${next.id}`)
      continue
    }
    if (startedIds.has(next.id)) {
      failTransfer(next.id, `Transfer ${next.id} was already started`)
      continue
    }

    runningSlots.add(next.id) // ← 同步预占：此处之后才允许出现 await
    startedIds.add(next.id)
    if (!transition(next.id, 'running')) {
      runningSlots.delete(next.id)
      startedIds.delete(next.id)
      continue
    }
    startRun(next.id, args)
  }
}

/** 调度入口：可重入保护，保证槽位检查与预占在同一同步段内完成 */
export function dispatch(): void {
  if (dispatching) {
    redispatchNeeded = true
    return
  }
  dispatching = true
  try {
    do {
      redispatchNeeded = false
      pump()
    } while (redispatchNeeded)
  } finally {
    dispatching = false
  }
}

/** 入队并在同一同步段内预占槽位；返回 transferId */
export function scheduleTransfer(args: TransferArgs): string {
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
  pendingArgs.set(id, args)
  dispatch()
  return id
}

export type TransferCancelResult =
  | { ok: true; mode: 'queued' }
  | { ok: false; reason: 'not-found' | 'finished' | 'unsupported-running' }

/** 取消：排队任务可真正取消；运行中任务后端无取消能力，明确拒绝而不是删记录 */
export function cancelTransfer(id: string): TransferCancelResult {
  const record = findRecord(id)
  if (!record) return { ok: false, reason: 'not-found' }
  if (record.status === 'running') {
    return { ok: false, reason: 'unsupported-running' }
  }
  if (record.status !== 'queued') return { ok: false, reason: 'finished' }
  if (!transition(id, 'cancelled', { message: 'Cancelled before start' })) {
    return { ok: false, reason: 'finished' }
  }
  settle(id)
  dispatch()
  return { ok: true, mode: 'queued' }
}

export type TransferRemoveResult =
  | { ok: true }
  | { ok: false; reason: 'not-found' | 'active' }

/** 移除：只允许终态记录，运行中/排队中移除会破坏并发统计 */
export function removeTransfer(id: string): TransferRemoveResult {
  const record = findRecord(id)
  if (!record) return { ok: false, reason: 'not-found' }
  if (!isTerminalStatus(record.status)) return { ok: false, reason: 'active' }
  useTransferQueue.setState(state => ({
    transfers: state.transfers.filter(t => t.id !== id),
  }))
  settle(id)
  return { ok: true }
}

export interface TransferQueueDiagnostics {
  maxConcurrent: number
  runningSlotIds: string[]
  startedCount: number
  pendingArgIds: string[]
  statusCounts: Record<TransferStatus, number>
}

export function getTransferQueueDiagnostics(): TransferQueueDiagnostics {
  const { transfers } = useTransferQueue.getState()
  const statusCounts: Record<TransferStatus, number> = {
    queued: 0,
    running: 0,
    done: 0,
    error: 0,
    cancelled: 0,
  }
  for (const record of transfers) statusCounts[record.status] += 1
  return {
    maxConcurrent: MAX_CONCURRENT,
    runningSlotIds: [...runningSlots],
    startedCount: startedIds.size,
    pendingArgIds: [...pendingArgs.keys()],
    statusCounts,
  }
}

/** 仅供测试：清空模块级状态，避免用例之间互相污染 */
export function __resetTransferQueueForTests(): void {
  runningSlots.clear()
  startedIds.clear()
  pendingArgs.clear()
  dispatching = false
  redispatchNeeded = false
}
