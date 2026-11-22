/**
 * T14 — 两个传输写同一个远端路径时，校验不能把别人的字节当作自己的证据。
 *
 * ## 缺陷的形状
 *
 * 校验发生在传输 `done` 之后，读的是**远端路径**，而不是「我写进去的那些字节」。
 * 两个传输指向同一路径时：
 *
 * ```
 * A 写完 → A 开始读远端算 hash
 *                       B 覆盖同一路径
 * A 的读取返回 B 的字节
 * ```
 *
 * 于是 A 的 `remoteHash` 是 **B 的内容**，而 A 的 `localHash` 是 **A 的内容**。两者
 * 不等 → A 被报成 `mismatch`（用户看到「文件不一致」，而实际上 A 的传输完全正确，
 * 只是被覆盖了）。更糟的方向也存在：如果 B 的内容恰好与 A 的相同，A 会显示
 * `verified` —— 用一个已经不存在于任何地方的文件去证明完整性。
 *
 * ## 这一轮先复现，再决定最小方案
 *
 * 三种可行方案，成本不同：
 *
 * 1. **按路径互斥** —— 同一远端路径的校验串行化。简单，但把并发写同一文件的场景变成
 *    排队，而用户并没有要求这样。
 * 2. **快照约束** —— 校验前记录远端的大小/mtime，读完再比对，变了就报 indeterminate。
 *    不改变并发行为，只是让「我读到的可能不是我的」变成可见的结论。
 * 3. **明确 indeterminate** —— 检测到同路径有更新的传输时，直接不声称已验证。
 *
 * 这个文件的用例**不预设**选哪一个；它钉住的是必须成立的不变量：
 *
 *   - A 绝不能显示 `verified`，除非读到的是 A 的字节；
 *   - A 的结果不能是「用户文件损坏」的断言（mismatch），当实际原因是覆盖；
 *   - 两个传输各自的记录互不污染。
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
import { __resetPathGenerationsForTests } from './sftp-transfer-path-generation'

/**
 * A runtime whose transfers settle only when the test says so, and whose remote hash is
 * answered by the test — that is the only way to reproduce "A read B's bytes" without a
 * real server racing us.
 */
interface Harness {
  settleTransfer: (index: number) => void
  finishRemoteHash: (transferId: string) => void
  /** What this transfer's remote read will answer, decided at release time. */
  setRemoteAnswer: (transferId: string, hash: string) => void
}

function install(): Harness {
  const setters: Array<() => void> = []
  const remoteResolvers = new Map<string, () => void>()
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
    // The local side is whatever this transfer sent.
    hash: `local-${transferId}`,
  }))
  /*
   * The remote hash's *answer* is decided when it is released, not when it is created.
   *
   * The first version captured the value in the promise's constructor, so a test that
   * changed the expected answer afterwards had no effect — and the case passed while
   * exercising a value it never chose. Deciding at release time is what lets a case say
   * "A's read returns A's own hash" *after* B has been set up.
   */
  const answers = new Map<string, string>()
  mocks.checksumRemote.mockImplementation(
    (transferId: string) =>
      new Promise(resolve => {
        remoteResolvers.set(transferId, () =>
          resolve({
            success: true,
            hash: answers.get(transferId) ?? `remote-${transferId}`,
          }),
        )
      }),
  )

  return {
    settleTransfer: index => setters[index]?.(),
    finishRemoteHash: id => remoteResolvers.get(id)?.(),
    setRemoteAnswer: (id, hash) => answers.set(id, hash),
  }
}

async function flush(times = 16) {
  for (let index = 0; index < times; index += 1) await Promise.resolve()
}

const records = () => useTransferQueue.getState().transfers
const record = (id: string) => records().find(entry => entry.id === id)

async function uploadTo(sessionId: string, remotePath: string): Promise<string> {
  await uploadFile({
    sessionId,
    localPath: `/tmp/${remotePath.split('/').pop()}`,
    remotePath,
    bytesTotal: 1024,
  })
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
  __resetPathGenerationsForTests()
  registerSession('s1')
  registerSession('s2')
  vi.clearAllMocks()
})

describe('T14 — two transfers onto one remote path', () => {
  it('the second transfer starts while the first is still verifying', async () => {
    /*
     * The precondition, asserted rather than assumed: the queue frees the *transfer*
     * slot at `done`, so a second write to the same path can begin while the first
     * one's integrity check is still reading. This is what makes the race possible and
     * it is by design (a finished transfer should not hold a slot for a hash).
     */
    const harness = install()
    const firstId = await uploadTo('s1', '/srv/shared.bin')
    harness.settleTransfer(0)
    await flush()

    // The first is done and verifying; its remote hash has not answered yet.
    expect(record(firstId)!.status).toBe('done')
    expect(mocks.checksumRemote).toHaveBeenCalledTimes(1)

    // A second transfer to the same path is admitted and runs.
    const secondId = await uploadTo('s2', '/srv/shared.bin')
    expect(secondId).not.toBe(firstId)
    expect(record(secondId)!.status).toBe('running')
  })

  it('each record keeps its own hashes — no cross-writing', async () => {
    /*
     * Whatever the resolution, this must hold: `setChecksumResult` is keyed by
     * transferId, so A's result can never land on B's record. Asserted first because
     * every other conclusion in this file depends on the two being separable.
     */
    const harness = install()
    // Distinct paths: this case is about record isolation, not about the overwrite
    // guard (which the next case covers).
    const firstId = await uploadTo('s1', '/srv/own-a.bin')
    harness.settleTransfer(0)
    await flush()
    const secondId = await uploadTo('s2', '/srv/own-b.bin')
    harness.settleTransfer(1)
    await flush()

    harness.finishRemoteHash(firstId)
    harness.finishRemoteHash(secondId)
    await vi.waitFor(() => expect(record(secondId)!.checksum?.remoteHash).toBeDefined())

    expect(record(firstId)!.checksum!.remoteHash).toBe(`remote-${firstId}`)
    expect(record(secondId)!.checksum!.remoteHash).toBe(`remote-${secondId}`)
    // The local hashes are the transfers' own, too.
    expect(record(firstId)!.checksum!.localHash).toBe(`local-${firstId}`)
    expect(record(secondId)!.checksum!.localHash).toBe(`local-${secondId}`)
  })

  it('a first transfer whose path was overwritten mid-check cannot claim verified', async () => {
    /*
     * ## The defect, reproduced
     *
     * A's check reads a **remote path**. If that path was rewritten by B between A's
     * `done` and A's read, whatever A read is not A's bytes — yet the hash comparison
     * has no way to know. This test puts the most favourable value in that read (it
     * returns A's own local hash) and reconstructs the overwrite, and the current
     * implementation answers `verified`.
     *
     * Reproduced before this case was written, with a standalone driver:
     *
     *     A status: done
     *     remote calls: 1
     *     A checksum: { localHash: "local-<A>", remoteHash: "local-<A>" }  verdict: verified
     *
     * — B had already finished writing the same path, and A still certified itself.
     *
     * The assertion is the invariant, not a chosen fix: A must not claim `verified`
     * when its path changed underneath it. Whether the product answers `indeterminate`
     * (the honest "the file I wrote is no longer there") or serialises same-path
     * checks is a design decision this test deliberately does not make.
     */
    const harness = install()
    const firstId = await uploadTo('s1', '/srv/shared.bin')
    harness.settleTransfer(0)
    await flush()
    expect(mocks.checksumRemote).toHaveBeenCalledTimes(1)

    // B overwrites the same path while A's remote read is still in flight, and finishes.
    const secondId = await uploadTo('s2', '/srv/shared.bin')
    harness.settleTransfer(1)
    await flush()
    expect(record(secondId)!.status).toBe('done')

    // A's read now answers — with A's own local hash, the best case for the old code.
    harness.setRemoteAnswer(firstId, `local-${firstId}`)
    harness.finishRemoteHash(firstId)
    await vi.waitFor(
      () =>
        expect(checksumVerdict(record(firstId)).verdict).not.toBe('computing'),
      { timeout: 3_000 },
    )

    const verdict = checksumVerdict(record(firstId)).verdict
    expect(
      verdict,
      `A reported ${verdict} after its path was overwritten by ${secondId}; a check ` +
        'that read the bytes of another transfer cannot certify this one',
    ).not.toBe('verified')
  })

  it('the overwriting transfer can still verify itself', async () => {
    // The rule must not be so blunt that it suppresses B's verdict: B's bytes are on the
    // path, so B's read is a true statement about B. Every transfer's remote hash is its
    // own local hash here — the "everything is fine" input.
    const harness = install()
    const firstId = await uploadTo('s1', '/srv/shared.bin')
    harness.settleTransfer(0)
    await flush()
    const secondId = await uploadTo('s2', '/srv/shared.bin')
    harness.settleTransfer(1)
    await flush()

    harness.setRemoteAnswer(secondId, `local-${secondId}`)
    harness.finishRemoteHash(secondId)
    await vi.waitFor(
      () => expect(checksumVerdict(record(secondId)).verdict).not.toBe('computing'),
      { timeout: 3_000 },
    )

    expect(checksumVerdict(record(secondId)).verdict).toBe('verified')
    // And A is not silently called verified as a side effect.
    expect(checksumVerdict(record(firstId)).verdict).not.toBe('verified')
  })

  it('two transfers to different paths are unaffected', async () => {
    // The guard must be scoped to the path. Serialising every check would slow the
    // ordinary case for a race that cannot happen there.
    const harness = install()
    const firstId = await uploadTo('s1', '/srv/a.bin')
    harness.settleTransfer(0)
    await flush()
    const secondId = await uploadTo('s2', '/srv/b.bin')
    harness.settleTransfer(1)
    await flush()

    harness.setRemoteAnswer(firstId, `local-${firstId}`)
    harness.setRemoteAnswer(secondId, `local-${secondId}`)
    harness.finishRemoteHash(firstId)
    harness.finishRemoteHash(secondId)
    // Both must reach a terminal verdict: `setChecksumResult` writes local and remote
    // separately, so "not computing" on one side can still be one side short.
    await vi.waitFor(
      () => {
        expect(checksumVerdict(record(firstId)).verdict).toBe('verified')
        expect(checksumVerdict(record(secondId)).verdict).toBe('verified')
      },
      { timeout: 3_000 },
    )
  })
})
