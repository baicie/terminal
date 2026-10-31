/**
 * SFTP 传输队列可靠性测试
 *
 * 断言的是真实状态转换与真实并发约束（store 记录 + 槽位账本），
 * 不是「mock 被调用过」：每个用例都读回 useTransferQueue 的实际记录。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/service/notifications', () => ({
  notify: vi.fn(async () => undefined),
}))

import { notify } from '@/service/notifications'
import { useTransferQueue, type TransferStatus } from '@/store/transfer-queue'
import {
  MAX_CONCURRENT,
  __resetTransferQueueForTests,
  canTransition,
  cancelTransfer,
  dispatch,
  getTransferQueueDiagnostics,
  removeTransfer,
} from './sftp-transfer-queue'
import {
  __resetProgressListenerForTests,
  configureTransferRuntime,
  downloadFile,
  getProgressListenerError,
  handleProgressEvent,
  uploadFile,
  uploadPaths,
  type TransferRuntime,
} from './sftp-transfer'
import type { SftpProgressPayload, TransferArgs } from './sftp-transfer-types'

type Kind = SftpProgressPayload['kind']

interface Invocation {
  id: string
  kind: 'upload' | 'download'
  args: TransferArgs
  settle: (error?: Error) => void
}

interface Harness {
  runtime: TransferRuntime
  invocations: Invocation[]
  state: { installCalls: number; listenerError?: string }
}

function createHarness(
  options: { available?: boolean; listenerError?: string } = {},
): Harness {
  const invocations: Invocation[] = []
  const state = { installCalls: 0, listenerError: options.listenerError }
  const runtime: TransferRuntime = {
    available: options.available ?? true,
    async installProgressListener() {
      state.installCalls += 1
      if (state.listenerError) throw new Error(state.listenerError)
    },
    run: (id, args) =>
      new Promise<void>((resolve, reject) => {
        invocations.push({
          id,
          kind: args.kind,
          args,
          settle: error => (error ? reject(error) : resolve()),
        })
      }),
  }
  return { runtime, invocations, state }
}

let harness: Harness

function useRuntime(options: Parameters<typeof createHarness>[0] = {}): Harness {
  harness = createHarness(options)
  configureTransferRuntime(harness.runtime)
  return harness
}

const records = () => useTransferQueue.getState().transfers
const byStatus = (status: TransferStatus) =>
  records().filter(record => record.status === status)
const findRecord = (id: string) => records().find(record => record.id === id)
const runSlotIds = () => getTransferQueueDiagnostics().runningSlotIds

/** 让所有已排队的微任务跑完 */
async function flush(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function emit(kind: Kind, transferId: string, extra: Partial<SftpProgressPayload> = {}) {
  handleProgressEvent({
    transferId,
    kind,
    bytesDone: 0,
    bytesTotal: 0,
    ...extra,
  })
}

async function enqueueUploads(count: number, sessionId = 's1'): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      uploadFile({
        sessionId,
        localPath: `/tmp/file-${index}.bin`,
        remotePath: `/srv/file-${index}.bin`,
      }),
    ),
  )
  await flush()
}

/** 依次结算后端调用，并断言每一步都不突破并发上限 */
async function drain(limit: number): Promise<void> {
  let settled = 0
  for (let guard = 0; guard < 4000 && settled < limit; guard += 1) {
    const invocation = harness.invocations[settled]
    if (!invocation) {
      await flush()
      continue
    }
    invocation.settle()
    settled += 1
    await flush()
    expect(runSlotIds().length).toBeLessThanOrEqual(MAX_CONCURRENT)
  }
}

beforeEach(() => {
  useTransferQueue.setState({ transfers: [], panelOpen: false })
  __resetTransferQueueForTests()
  __resetProgressListenerForTests()
  configureTransferRuntime(null)
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// 并发上限
// ---------------------------------------------------------------------------

describe('并发上限 MAX_CONCURRENT', () => {
  it.each([10, 50, 100])('同时入队 %i 个任务，running 恒为 3', async count => {
    useRuntime()
    await enqueueUploads(count)

    expect(MAX_CONCURRENT).toBe(3)
    expect(byStatus('running')).toHaveLength(3)
    expect(runSlotIds()).toHaveLength(3)
    expect(byStatus('queued')).toHaveLength(count - 3)
    expect(harness.invocations).toHaveLength(3)
    expect(getTransferQueueDiagnostics().startedCount).toBe(3)
  })

  it('后端长时间不返回首个 progress 时仍然只有 3 个在跑', async () => {
    useRuntime()
    await enqueueUploads(20)

    expect(byStatus('running')).toHaveLength(3)
    expect(byStatus('queued')).toHaveLength(17)
    for (const record of byStatus('running')) {
      expect(record.bytesDone).toBe(0)
      expect(record.speed).toBe(0)
    }
    expect(runSlotIds().length).toBeLessThanOrEqual(MAX_CONCURRENT)
  })

  it('完成一个补位一个，全程不超过上限', async () => {
    useRuntime()
    await enqueueUploads(10)

    await drain(10)

    expect(runSlotIds()).toHaveLength(0)
    expect(byStatus('done')).toHaveLength(10)
    expect(getTransferQueueDiagnostics().startedCount).toBe(10)
  })

  it('100 个任务跑完后没有幽灵任务或槽位泄漏', async () => {
    useRuntime()
    await enqueueUploads(100)
    await drain(100)

    const diagnostics = getTransferQueueDiagnostics()
    expect(diagnostics.statusCounts.done).toBe(100)
    expect(diagnostics.statusCounts.running).toBe(0)
    expect(diagnostics.statusCounts.queued).toBe(0)
    expect(diagnostics.runningSlotIds).toHaveLength(0)
    expect(diagnostics.pendingArgIds).toHaveLength(0)
    expect(diagnostics.startedCount).toBe(100)
    expect(new Set(harness.invocations.map(item => item.id)).size).toBe(100)
  })

  it('重复 dispatch 不会让同一个 transferId 启动两次', async () => {
    useRuntime()
    await enqueueUploads(5)
    dispatch()
    dispatch()
    await flush()

    const started = harness.invocations.map(item => item.id)
    expect(started).toHaveLength(3)
    expect(new Set(started).size).toBe(3)
  })

  it('清空 store（关闭页面再进入）后槽位不泄漏，也不突破上限', async () => {
    useRuntime()
    await enqueueUploads(5)
    expect(runSlotIds()).toHaveLength(3)

    useTransferQueue.setState({ transfers: [] })
    await enqueueUploads(1)
    await flush()

    expect(byStatus('queued')).toHaveLength(1)
    expect(harness.invocations).toHaveLength(3)

    for (const invocation of harness.invocations.slice(0, 3)) invocation.settle()
    await flush()

    expect(harness.invocations).toHaveLength(4)
    expect(runSlotIds()).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 事件健壮性
// ---------------------------------------------------------------------------

describe('progress / done / error 事件', () => {
  it('重复的成功事件不会覆盖终态或二次释放槽位', async () => {
    useRuntime()
    await enqueueUploads(5)
    const id = harness.invocations[0].id

    emit('done', id, { bytesDone: 10, bytesTotal: 10 })
    emit('done', id, { bytesDone: 10, bytesTotal: 10 })
    emit('progress', id, { bytesDone: 3, bytesTotal: 10 })
    await flush()

    const record = findRecord(id)!
    expect(record.status).toBe('done')
    expect(record.bytesDone).toBe(10)
    expect(byStatus('running')).toHaveLength(3)
    expect(harness.invocations).toHaveLength(4)
    expect(getTransferQueueDiagnostics().startedCount).toBe(4)
  })

  it('重复的失败事件只让记录失败一次，并发槽位只释放一次', async () => {
    useRuntime()
    await enqueueUploads(5)
    const id = harness.invocations[0].id

    emit('error', id, { message: 'connection reset' })
    emit('error', id, { message: 'connection reset' })
    await flush()

    expect(findRecord(id)!.status).toBe('error')
    expect(findRecord(id)!.message).toBe('connection reset')
    expect(harness.invocations).toHaveLength(4)
    expect(runSlotIds()).toHaveLength(3)
  })

  it('完成后的迟到 progress 被忽略', async () => {
    useRuntime()
    await enqueueUploads(2)
    const id = harness.invocations[0].id

    emit('done', id, { bytesDone: 100, bytesTotal: 100 })
    emit('progress', id, { bytesDone: 30, bytesTotal: 100 })
    emit('error', id, { message: 'late error' })
    await flush()

    const record = findRecord(id)!
    expect(record.status).toBe('done')
    expect(record.bytesDone).toBe(100)
    expect(record.message).toBeUndefined()
  })

  it('未知或已失效的 transferId 事件被忽略，不产生幽灵记录', async () => {
    useRuntime()
    await enqueueUploads(2)
    const before = records().length
    const slots = runSlotIds().length

    emit('progress', 'ghost-id', { bytesDone: 1, bytesTotal: 2 })
    emit('done', 'ghost-id')
    emit('error', 'ghost-id', { message: 'nope' })
    await flush()

    expect(records()).toHaveLength(before)
    expect(runSlotIds()).toHaveLength(slots)
  })

  it('排队中的记录收到 progress 时不会被伪造成 running', async () => {
    useRuntime()
    await enqueueUploads(5)
    const queuedId = byStatus('queued')[0].id

    emit('progress', queuedId, { bytesDone: 5, bytesTotal: 10 })
    await flush()

    expect(findRecord(queuedId)!.status).toBe('queued')
    expect(findRecord(queuedId)!.bytesDone).toBe(0)
  })

  it('会话断开后所有在跑任务失败，槽位归零后可重连续传', async () => {
    useRuntime()
    await enqueueUploads(5)
    for (const invocation of [...harness.invocations]) {
      emit('error', invocation.id, { message: 'session disconnected' })
    }
    await flush()
    expect(byStatus('error')).toHaveLength(3)
    expect(byStatus('running')).toHaveLength(2)

    await drain(5)
    expect(runSlotIds()).toHaveLength(0)

    await enqueueUploads(2, 'session-after-reconnect')
    await flush()
    expect(byStatus('running')).toHaveLength(2)
    expect(harness.invocations.at(-1)!.args.sessionId).toBe('session-after-reconnect')
  })
})

// ---------------------------------------------------------------------------
// 失败路径
// ---------------------------------------------------------------------------

describe('失败路径', () => {
  it('同步失败：runner 直接抛错时记录为 error 并释放槽位', async () => {
    const inner = createHarness()
    configureTransferRuntime({
      ...inner.runtime,
      run: () => {
        throw new Error('sync boom')
      },
    })
    await enqueueUploads(2)
    await flush()

    for (const record of records()) {
      expect(record.status).toBe('error')
      expect(record.message).toBe('sync boom')
    }
    expect(runSlotIds()).toHaveLength(0)
    expect(vi.mocked(notify)).toHaveBeenCalled()
  })

  it('异步失败：invoke reject 后记录 error、释放槽位并补位', async () => {
    useRuntime()
    await enqueueUploads(5)
    expect(harness.invocations).toHaveLength(3)

    harness.invocations[0].settle(new Error('disk full'))
    await flush()

    expect(findRecord(harness.invocations[0].id)!.status).toBe('error')
    expect(findRecord(harness.invocations[0].id)!.message).toBe('disk full')
    expect(harness.invocations).toHaveLength(4)
    expect(runSlotIds()).toHaveLength(3)
    const failedNotifications = vi
      .mocked(notify)
      .mock.calls.filter(([payload]) => payload.type === 'error')
    expect(failedNotifications).toHaveLength(1)
  })

  it('缺失 pending args 的记录明确失败，不产生永久假 running', async () => {
    useRuntime()
    // 直接写 store 制造「队列与参数不同步」：没有 pending args 的 queued 记录
    useTransferQueue.getState().enqueue(
      {
        id: 'orphan-id',
        kind: 'upload',
        name: 'orphan.bin',
        localPath: '/tmp/orphan.bin',
        remotePath: '/srv/orphan.bin',
        sessionId: 's1',
      },
      true,
    )
    dispatch()
    await flush()

    const orphan = findRecord('orphan-id')!
    expect(orphan.status).toBe('error')
    expect(orphan.message).toContain('Missing transfer arguments')
    expect(byStatus('running')).toHaveLength(0)
    expect(harness.invocations).toHaveLength(0)
    expect(runSlotIds()).toHaveLength(0)
  })

  it('缺失 pending args 不会阻塞其余任务', async () => {
    useRuntime()
    await enqueueUploads(5)
    useTransferQueue.getState().enqueue(
      {
        id: 'orphan-id',
        kind: 'upload',
        name: 'orphan.bin',
        localPath: '/tmp/orphan.bin',
        remotePath: '/srv/orphan.bin',
        sessionId: 's1',
      },
      true,
    )
    dispatch()
    await flush()
    // 槽位被占满时孤儿任务还轮不到，说明不会插队；空出槽位后必须明确失败
    expect(findRecord('orphan-id')!.status).toBe('queued')

    await drain(5)
    await flush()
    expect(findRecord('orphan-id')!.status).toBe('error')
    expect(findRecord('orphan-id')!.message).toContain('Missing transfer arguments')
    expect(byStatus('done')).toHaveLength(5)
    expect(runSlotIds()).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 取消与移除
// ---------------------------------------------------------------------------

describe('取消与移除语义', () => {
  it('取消排队任务是真的取消：后端从未收到该任务', async () => {
    useRuntime()
    await enqueueUploads(5)
    const queuedId = byStatus('queued')[0].id

    expect(cancelTransfer(queuedId)).toEqual({ ok: true, mode: 'queued' })
    await flush()

    expect(findRecord(queuedId)!.status).toBe('cancelled')
    expect(harness.invocations.map(item => item.id)).not.toContain(queuedId)
    expect(byStatus('running')).toHaveLength(3)
    expect(getTransferQueueDiagnostics().pendingArgIds).not.toContain(queuedId)
  })

  it('取消运行中任务被明确拒绝，状态与槽位都不变', async () => {
    useRuntime()
    await enqueueUploads(3)
    const runningId = runSlotIds()[0]

    expect(cancelTransfer(runningId)).toEqual({
      ok: false,
      reason: 'unsupported-running',
    })
    await flush()

    expect(findRecord(runningId)!.status).toBe('running')
    expect(findRecord(runningId)).toBeDefined()
    expect(runSlotIds()).toHaveLength(3)
  })

  it('只允许移除终态记录，运行中/排队中移除被拒绝', async () => {
    useRuntime()
    await enqueueUploads(5)
    const doneId = harness.invocations[0].id
    emit('done', doneId)
    await flush()

    expect(removeTransfer(doneId)).toEqual({ ok: true })
    expect(findRecord(doneId)).toBeUndefined()

    const runningId = runSlotIds()[0]
    expect(removeTransfer(runningId)).toEqual({ ok: false, reason: 'active' })
    expect(findRecord(runningId)).toBeDefined()

    const queuedId = byStatus('queued')[0].id
    expect(removeTransfer(queuedId)).toEqual({ ok: false, reason: 'active' })
    expect(findRecord(queuedId)).toBeDefined()
    expect(removeTransfer('missing-id')).toEqual({ ok: false, reason: 'not-found' })
  })

  it('状态机只接受合法转换', () => {
    expect(canTransition('queued', 'running')).toBe(true)
    expect(canTransition('queued', 'cancelled')).toBe(true)
    expect(canTransition('running', 'done')).toBe(true)
    expect(canTransition('running', 'error')).toBe(true)
    expect(canTransition('queued', 'done')).toBe(false)
    expect(canTransition('running', 'cancelled')).toBe(false)
    expect(canTransition('done', 'running')).toBe(false)
    expect(canTransition('cancelled', 'running')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// listener 初始化
// ---------------------------------------------------------------------------

describe('progress listener 初始化', () => {
  it('并发初始化只安装一次监听器', async () => {
    useRuntime()
    await Promise.all([
      uploadFile({ sessionId: 's1', localPath: '/tmp/a', remotePath: '/srv/a' }),
      uploadFile({ sessionId: 's1', localPath: '/tmp/b', remotePath: '/srv/b' }),
      downloadFile({ sessionId: 's1', remotePath: '/srv/c', localPath: '/tmp/c' }),
      downloadFile({ sessionId: 's1', remotePath: '/srv/d', localPath: '/tmp/d' }),
    ])
    await flush()

    expect(harness.state.installCalls).toBe(1)
    expect(records()).toHaveLength(4)
    expect(byStatus('running')).toHaveLength(3)
  })

  it('监听器创建失败不静默：传输明确失败并通知，之后可重试成功', async () => {
    useRuntime({ listenerError: 'listen failed' })
    await uploadFile({ sessionId: 's1', localPath: '/tmp/x', remotePath: '/srv/x' })
    await flush()

    const failed = records()[0]
    expect(failed.status).toBe('error')
    expect(failed.message).toContain('listener unavailable')
    expect(failed.message).toContain('listen failed')
    expect(getProgressListenerError()).toBe('listen failed')
    expect(harness.invocations).toHaveLength(0)
    expect(vi.mocked(notify)).toHaveBeenCalledTimes(1)

    harness.state.listenerError = undefined
    await uploadFile({ sessionId: 's1', localPath: '/tmp/y', remotePath: '/srv/y' })
    await flush()

    expect(harness.state.installCalls).toBe(2)
    expect(byStatus('running')).toHaveLength(1)
    expect(harness.invocations).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 批量上传
// ---------------------------------------------------------------------------

describe('uploadPaths 批量上传', () => {
  it('100 个文件批量入队仍受 3 并发约束，远端路径正确', async () => {
    useRuntime()
    const localPaths = Array.from(
      { length: 100 },
      (_, index) => `/tmp/batch-${index}.bin`,
    )
    await uploadPaths({
      sessionId: 's1',
      remoteDir: '/srv/uploads/',
      localPaths,
    })
    await flush()

    expect(records()).toHaveLength(100)
    expect(byStatus('running')).toHaveLength(3)
    expect(byStatus('queued')).toHaveLength(97)
    expect(harness.invocations).toHaveLength(3)
    const queued = byStatus('queued')
    expect(queued.every(record => record.remotePath.startsWith('/srv/uploads/'))).toBe(true)
    expect(queued.every(record => !record.remotePath.includes('//'))).toBe(true)
  })
})
