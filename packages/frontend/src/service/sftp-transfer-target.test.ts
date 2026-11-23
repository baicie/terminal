/**
 * R01 — 目标身份与写入期竞态。
 *
 * ## 现有实现的三个问题
 *
 * T14 把「路径代次」的 key 从 `sessionId+remotePath` 改成只有 `remotePath`，理由是
 * 两个 SSH 会话写同一文件时前者不生效。那个理由成立，但改法过宽：`/srv/shared.bin`
 * 在**两台不同服务器**上是两个不同的文件，现在会被当成同一个 —— A 在 host1 校验，
 * B 在 host2 写同名路径，A 被误判为 `indeterminate`。
 *
 * 还有两个更深的问题：
 *
 * 2. **代次只记 0/1 次写入，没有「写入进行中」的概念**。A 的校验读完远端、在回调里
 *    比对代次 —— 但 B 若在 A 读完之后、比对之前**开始**写入（还没 done），代次尚未
 *    递增，A 照样 `verified`。实测可达：`noteWrite` 只在 `done` 时调用。
 * 3. **Registry 永不清理**：每个写过的路径留一条记录，进程生命周期内只增不减。
 *
 * ## 本文件钉住的不变量
 *
 * | # | 不变量 |
 * | --- | --- |
 * | 1 | 两台不同服务器上的同名路径互不影响 |
 * | 2 | 同一服务器的两个会话写同一路径 → 冲突可见 |
 * | 3 | 同一服务器经两个 Host 配置访问 → 仍然冲突可见 |
 * | 4 | B 在 A 校验期间**开始**写入（尚未 done）→ A 不得 verified |
 * | 5 | 不同路径的传输正常并行 |
 * | 6 | 完成的路径不再永久占用内存 |
 * | 7 | 失败/取消/断开的传输释放它占用的资源 |
 *
 * 第 4 条是这一轮最重要的：它要求把「写入进行中」也纳入约束，而不是只比较写入完成
 * 次数。测试用**可控的时序**复现 —— 先让 A 的远端读取挂起，再让 B 开始写，然后放行
 * A 的读取。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  checksumLocal: vi.fn(),
  checksumRemote: vi.fn(),
}))

vi.mock('@/features/terminal/services/sftp', () => ({
  sftpService: {
    checksumLocal: mocks.checksumLocal,
    checksumRemote: mocks.checksumRemote,
  },
}))

vi.mock('@/service/notifications', () => ({
  notify: vi.fn(async () => undefined),
}))

import { useTransferQueue } from '@/store/transfer-queue'
import { checksumVerdict } from '@/store/transfer-checksum-verdict'
import { __resetSessionClaimsForTests, registerSession } from './sftp-session-claim'
import {
  __resetProgressListenerForTests,
  configureTransferRuntime,
  uploadFile,
  type TransferRuntime,
} from './sftp-transfer'
import { __resetTransferQueueForTests } from './sftp-transfer-queue'
import {
  __resetTargetsForTests,
  activeTargetCount,
  beginWrite,
  targetKeyOf,
} from './sftp-transfer-target'

/** A runtime whose transfers the test settles by hand. */
interface Harness {
  settleTransfer: (index: number) => void
  remoteResolvers: Map<string, () => void>
  answers: Map<string, string>
}

function install(): Harness {
  const setters: Array<() => void> = []
  const remoteResolvers = new Map<string, () => void>()
  const answers = new Map<string, string>()
  const runtime: TransferRuntime = {
    available: true,
    async installProgressListener() {},
    run: () =>
      new Promise<void>(resolve => {
        setters.push(resolve)
      }),
  }
  configureTransferRuntime(runtime)
  mocks.checksumLocal.mockImplementation(async (transferId: string) => ({
    success: true,
    hash: answers.get(transferId) ?? `local-${transferId}`,
  }))
  mocks.checksumRemote.mockImplementation(
    (transferId: string) =>
      new Promise(resolve => {
        remoteResolvers.set(transferId, () =>
          resolve({
            success: true,
            hash: answers.get(transferId) ?? `local-${transferId}`,
          }),
        )
      }),
  )
  return { settleTransfer: i => setters[i]?.(), remoteResolvers, answers }
}

async function flush(times = 16) {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
}

const records = () => useTransferQueue.getState().transfers
const record = (id: string) => records().find(entry => entry.id === id)

/** A transfer target: the server it is on, and the path on that server. */
const target = (hostname: string, remotePath: string, port = 22, username = 'u') => ({
  hostname,
  port,
  username,
  remotePath,
})

type UploadSpec = {
  hostname: string
  port?: number
  username?: string
  remotePath: string
}

async function upload(spec: UploadSpec): Promise<string> {
  await uploadFile({
    sessionId: spec.username ?? 's1',
    localPath: `/tmp/${spec.remotePath.split('/').pop()}`,
    remotePath: spec.remotePath,
    bytesTotal: 1024,
    // Not present yet in `TransferArgs` — see the first failing test. Added here so the
    // rest of the file expresses what the product *should* be able to decide from.
    target: target(spec.hostname, spec.remotePath, spec.port, spec.username),
  } as never)
  await flush()
  const running = records().filter(entry => entry.status === 'running')
  const last = running[running.length - 1]
  if (!last) throw new Error('the upload did not start')
  return last.id
}

beforeEach(() => {
  useTransferQueue.setState({ transfers: [], panelOpen: false })
  __resetTransferQueueForTests()
  __resetProgressListenerForTests()
  __resetSessionClaimsForTests()
  __resetTargetsForTests()
  registerSession('s1')
  registerSession('s2')
  vi.clearAllMocks()
})

describe('R01 — a target is a server plus a path, not a path', () => {
  it('two servers may have the same path without colliding', async () => {
    /*
     * The regression T14 introduced. `/srv/shared.bin` on host1 and the same string on
     * host2 are different files; a registry keyed on the path alone cannot tell.
     */
    const key = (hostname: string) => targetKeyOf(target(hostname, '/srv/shared.bin'))
    expect(key('host1.example.com')).not.toBe(key('host2.example.com'))
  })

  it('the same server reached through two host configs still collides', () => {
    // Two Host entries (different ids, different credential refs) pointing at the same
    // server must produce the same target key. The key must therefore be built from the
    // connection coordinates, not from the Host row.
    const viaConfigA = targetKeyOf(target('server.example.com', '/srv/x', 22, 'deploy'))
    const viaConfigB = targetKeyOf(target('server.example.com', '/srv/x', 22, 'deploy'))
    expect(viaConfigA).toBe(viaConfigB)
  })

  it('a different username on the same host is a different target', () => {
    // Two accounts on one machine see different home directories, and may have different
    // permissions on the same path. Treating them as one target would report a conflict
    // that cannot happen, and would refuse to certify two independent transfers.
    expect(targetKeyOf(target('h', '/srv/x', 22, 'alice'))).not.toBe(
      targetKeyOf(target('h', '/srv/x', 22, 'bob')),
    )
  })

  it('a different port on the same hostname is a different target', () => {
    expect(targetKeyOf(target('h', '/srv/x', 22))).not.toBe(
      targetKeyOf(target('h', '/srv/x', 2222)),
    )
  })

  it('the path is normalised before it becomes part of the key', () => {
    /*
     * `/srv//a/../x` and `/srv/x` are the same file. Without normalisation two transfers
     * on one server would look independent while writing the same bytes.
     */
    const canonical = targetKeyOf(target('h', '/srv/x'))
    for (const variant of ['/srv//x', '/srv/./x', '/srv/a/../x', '/srv/x/']) {
      expect(targetKeyOf(target('h', variant)), variant).toBe(canonical)
    }
  })

  it('hostname case does not split one server into two', () => {
    expect(targetKeyOf(target('Server.Example.COM', '/srv/x'))).toBe(
      targetKeyOf(target('server.example.com', '/srv/x')),
    )
  })
})

describe('R01 — a write that has begun is already a conflict', () => {
  it('a write in progress blocks certification even before it finishes', async () => {
    /*
     * ## The hole the generation counter cannot close
     *
     * `noteWrite` is called at `done`. A check that snapshots the counter at its start
     * and re-reads it at its end is blind to a write that **started** after the snapshot
     * and has not finished: the counter has not moved yet.
     *
     * Timeline this test builds:
     *
     *   A done → A snapshots (generation 1) → A's remote read hangs
     *   B starts writing the same target        ← counter still 1
     *   A's read returns
     *   → A must not claim `verified`
     */
    const harness = install()
    const firstId = await upload({ hostname: 'server.example.com', remotePath: '/srv/shared.bin' })
    harness.settleTransfer(0)
    await flush()
    expect(mocks.checksumRemote).toHaveBeenCalledTimes(1)

    // B begins writing the same target and has NOT finished.
    const heldWrite = beginWrite(target('server.example.com', '/srv/shared.bin'))
    expect(activeTargetCount()).toBeGreaterThan(0)

    harness.answers.set(firstId, `local-${firstId}`)
    harness.remoteResolvers.get(firstId)?.()
    await vi.waitFor(
      () => expect(checksumVerdict(record(firstId)).verdict).not.toBe('computing'),
      { timeout: 3_000 },
    )

    const verdict = checksumVerdict(record(firstId)).verdict
    heldWrite.release()
    expect(
      verdict,
      `A certified itself while ${'B'} was mid-write on the same target`,
    ).not.toBe('verified')
  })

  it('a write that finishes during the check is caught as before', async () => {
    // The T14 case, kept: B completes while A is reading.
    const harness = install()
    const firstId = await upload({ hostname: 'server.example.com', remotePath: '/srv/shared.bin' })
    harness.settleTransfer(0)
    await flush()

    const other = await upload({ hostname: 'server.example.com', remotePath: '/srv/shared.bin' })
    harness.settleTransfer(1)
    await flush()
    expect(record(other)!.status).toBe('done')

    harness.answers.set(firstId, `local-${firstId}`)
    harness.remoteResolvers.get(firstId)?.()
    await vi.waitFor(
      () => expect(checksumVerdict(record(firstId)).verdict).not.toBe('computing'),
      { timeout: 3_000 },
    )
    expect(checksumVerdict(record(firstId)).verdict).not.toBe('verified')
  })

  it('another server writing the same path does not disturb this check', async () => {
    // The false positive the path-only key produced: unrelated servers colliding.
    const harness = install()
    const firstId = await upload({ hostname: 'server-a.example.com', remotePath: '/srv/shared.bin' })
    harness.settleTransfer(0)
    await flush()

    const elsewhere = await upload({ hostname: 'server-b.example.com', remotePath: '/srv/shared.bin' })
    harness.settleTransfer(1)
    await flush()
    expect(record(elsewhere)!.status).toBe('done')

    harness.answers.set(firstId, `local-${firstId}`)
    harness.remoteResolvers.get(firstId)?.()
    await vi.waitFor(
      () => expect(checksumVerdict(record(firstId)).verdict).toBe('verified'),
      { timeout: 3_000 },
    )
  })

  it('two different paths on one server both verify', async () => {
    const harness = install()
    const a = await upload({ hostname: 'server.example.com', remotePath: '/srv/a.bin' })
    harness.settleTransfer(0)
    await flush()
    const b = await upload({ hostname: 'server.example.com', remotePath: '/srv/b.bin' })
    harness.settleTransfer(1)
    await flush()

    harness.answers.set(a, `local-${a}`)
    harness.answers.set(b, `local-${b}`)
    harness.remoteResolvers.get(a)?.()
    harness.remoteResolvers.get(b)?.()
    await vi.waitFor(
      () => {
        expect(checksumVerdict(record(a)).verdict).toBe('verified')
        expect(checksumVerdict(record(b)).verdict).toBe('verified')
      },
      { timeout: 3_000 },
    )
  })
})

describe('R01 — a transfer with no server identity degrades, and says why', () => {
  it('records an explicit reason rather than throwing its way to indeterminate', async () => {
    /*
     * The verifier cannot rule out an overwrite when it does not know which server the
     * transfer went to. The verdict must then be `indeterminate` **with a reason that says
     * so** — not an `indeterminate` that happens to fall out of a `TypeError` on a null
     * target, which reads the same in the verdict and says nothing to the user.
     *
     * Measured while mutation-testing: deleting the `target === null` guard left every
     * assertion green, because `targetKeyOf(null)` throws and the catch path also produces
     * `indeterminate`. This case is what separates the two.
     */
    const harness = install()
    await uploadFile({
      sessionId: 's1',
      localPath: '/tmp/anonymous.bin',
      remotePath: '/srv/anonymous.bin',
      bytesTotal: 1024,
      // No `target`: this is what a caller that only has a session id passes.
    })
    await flush()
    const running = records().find(entry => entry.status === 'running')
    if (!running) throw new Error('the upload did not start')

    harness.settleTransfer(0)
    await flush()
    harness.answers.set(running.id, `local-${running.id}`)
    harness.remoteResolvers.get(running.id)?.()
    await vi.waitFor(
      () => expect(checksumVerdict(record(running.id)).verdict).not.toBe('computing'),
      { timeout: 3_000 },
    )

    const verdict = checksumVerdict(record(running.id))
    expect(verdict.verdict).toBe('indeterminate')
    expect(verdict.error ?? '').toMatch(/server identity/i)
    // And specifically NOT a thrown-error message, which would mean the guard was absent.
    expect(verdict.error ?? '').not.toMatch(/Cannot read|undefined|null is not/i)
  })
})

describe('R01 — the registry does not grow without bound', () => {
  it('a finished, uncontested target is reclaimed', async () => {
    /*
     * The ledger must not keep one entry per path the app has ever written. This asserts
     * the count returns to zero once the write and the check are both done — measured on
     * the live registry, not on a counter the module keeps about itself.
     */
    const harness = install()
    const id = await upload({ hostname: 'server.example.com', remotePath: '/srv/once.bin' })
    harness.settleTransfer(0)
    await flush()

    harness.answers.set(id, `local-${id}`)
    harness.remoteResolvers.get(id)?.()
    await vi.waitFor(
      () => expect(checksumVerdict(record(id)).verdict).toBe('verified'),
      { timeout: 3_000 },
    )
    await flush(32)

    expect(activeTargetCount()).toBe(0)
  })

  it('a hundred distinct paths leave nothing behind', async () => {
    /*
     * The registry must return to zero once every transfer has completed **and** its
     * check has finished. Settling only the transfer is not enough: a check that is still
     * reading legitimately holds its target (that is the whole point of the read claim),
     * so the test has to drive both phases the way the product does.
     */
    const harness = install()
    const ids: string[] = []
    for (let index = 0; index < 100; index += 1) {
      ids.push(
        await upload({
          hostname: 'server.example.com',
          remotePath: `/srv/bulk-${index}.bin`,
        }),
      )
      // Settle as we go: MAX_CONCURRENT is 3, so a transfer cannot be admitted until an
      // earlier one has finished.
      harness.settleTransfer(index)
      await flush(4)
    }
    // Let every outstanding check answer, then confirm the registry drained.
    for (const id of ids) harness.remoteResolvers.get(id)?.()
    await flush(96)

    expect(activeTargetCount()).toBe(0)
  })

  it('a released write does not linger', () => {
    const held = beginWrite(target('h', '/srv/x'))
    expect(activeTargetCount()).toBe(1)
    held.release()
    expect(activeTargetCount()).toBe(0)
    // Releasing twice is a no-op, not a negative count.
    held.release()
    expect(activeTargetCount()).toBe(0)
  })

  it('two concurrent writes on one target both hold it until each releases', () => {
    const first = beginWrite(target('h', '/srv/y'))
    const second = beginWrite(target('h', '/srv/y'))
    expect(activeTargetCount()).toBe(1)
    first.release()
    // The second write is still running: the target must stay held.
    expect(activeTargetCount()).toBe(1)
    second.release()
    expect(activeTargetCount()).toBe(0)
  })
})
