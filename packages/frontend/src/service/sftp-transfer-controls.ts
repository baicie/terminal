/**
 * 记录层面的两个操作：取消（排队中）与移除（已终止）。
 *
 * 拆出 `sftp-transfer-queue.ts` 是因为那个文件是**状态机**——转换表、槽位账本、
 * 调度循环。这两个函数只读状态并调用状态机的入口，不定义任何转换，所以它们的
 * 复杂度不属于那里。两者的规则一个字都没改。
 */
import { useTransferQueue } from '@/store/transfer-queue'
import {
  dispatch,
  findRecord,
  isTerminalStatus,
  settle,
  transition,
} from './sftp-transfer-queue'

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

