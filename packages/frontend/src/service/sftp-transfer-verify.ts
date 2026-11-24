/**
 * 传输完成之后的完整性校验交接。
 *
 * 单独一个模块，因为它不是队列状态机的一部分：槽位在这里已经释放，记录已经是
 * `done`，剩下的事情只有「谁来读远端文件」和「谁在它读完之前保住这个会话」。
 *
 * 这两件事都有过缺陷：
 *
 * - **没有人读**：`verifyChecksum` 整条链完整实现、有测试，却没有任何调用方，
 *   于是每一次上传下载都以 `checksum: undefined` 结束，「done」被当成了「已验证」。
 * - **读的时候会话已经不在了**：校验发生在传输之后，而准入层的 claim 在
 *   `scheduleTransfer()` 就释放了。不自己声明会话仍在使用，关闭 Dock / 切换 Host
 *   时的 `isSessionIdle()` 会回答「空闲」，连接被关掉，而校验还在读远端文件。
 *
 * 所以这里持有两样东西：一个由调用方注入的校验器（测试可以注入永不 resolve 的
 * 版本以观察生命周期），和一个**用本次传输自己的 `sessionId` 取的 claim**。
 * 它从不读「当前」host，所以旧 Host 的哈希不可能写进新 Host 的记录。
 */
import { useTransferQueue } from '@/store/transfer-queue'
import { claimSession } from './sftp-session-claim'
import {
  beginRead,
  completionsOf,
  isContended,
  releaseIfIdle,
  targetKeyOf,
  targetOfArgs,
} from './sftp-transfer-target'
import type { TransferArgs } from './sftp-transfer-types'

/**
 * 校验端；返回 `null` 表示「不校验」（例如非 Tauri 环境）。
 *
 * 一个注入点而不是直接 import，理由和 `TransferRunner` 一样：这个模块需要的只是
 * 「有没有人愿意对这个传输做校验」这个事实。
 */
export type TransferVerifier = (
  id: string,
  args: TransferArgs,
) => Promise<unknown> | null

const noVerifier: TransferVerifier = () => null

let verifier: TransferVerifier = noVerifier

export function configureTransferVerifier(next: TransferVerifier | null): void {
  verifier = next ?? noVerifier
}

/**
 * 正在校验的传输。
 *
 * 与运行槽位分开：槽位是**传输**的并发预算，校验不占用它——传输已经结束，让它
 * 继续占着会让排队的第 4 个文件一直等到哈希跑完。校验对会话的占用由它自己的
 * claim 表达，`isSessionIdle()` 读 claims。
 */
const verifyingIds = new Set<string>()

export function isVerifying(id: string): boolean {
  return verifyingIds.has(id)
}

export function verifyingTransferIds(): string[] {
  return [...verifyingIds]
}

/** Test-only: drop the registry. Claims are the claim module's to reset. */
export function __resetVerificationForTests(): void {
  verifyingIds.clear()
  verifier = noVerifier
}

/** 校验开始时把记录置为「正在算」，失败时留下可读的原因而不是永远 computing。 */
function beginChecksum(id: string): void {
  useTransferQueue.getState().initChecksum(id)
}

function failChecksum(id: string, message: string): void {
  beginChecksum(id)
  useTransferQueue.getState().setChecksumResult(id, 'remote', {
    success: false,
    error: message,
  })
}

/**
 * 交接：槽位已经释放，把校验接过去。
 *
 * 顺序是这段代码的全部内容。`settle()`（清 `verifyingIds`）不能在校验登记之后跑，
 * 否则刚写下的「仍在用这个会话」会被自己抹掉。因此：
 *
 * 1. 调用方先释放槽位并推进队列；
 * 2. 这里取校验器的答案，`null` 表示这件传输不校验；
 * 3. 取 claim —— 取不到就如实记成「没能校验」，绝不记成「不一致」；
 * 4. 校验结束（成功、失败或抛错）才 `verifyingIds.delete` + `claim.release()`。
 */
export function handOffVerification(
  id: string,
  args: TransferArgs,
): void {
  // ## Claim first, start second
  //
  // Calling the verifier before taking the claim started the remote read and only
  // then discovered the session was closing — an IPC round trip onto a connection
  // the app had already decided to tear down, whose failure then had to be
  // interpreted. Asking first makes "this connection is going away" a fact known
  // before any work starts, and the answer is recorded as indeterminate.
  //
  // The claim uses this transfer's own args. A host switch changes what the dock
  // shows; it cannot change what these bytes were, so the hash can only land here.
  const claim = claimSession(args.sessionId)
  if (!claim.ok) {
    failChecksum(
      id,
      claim.reason === 'closing'
        ? 'The connection closed before the integrity check could run.'
        : 'The connection is no longer available for the integrity check.',
    )
    return
  }

  /*
   * ## A target is a server plus a path, and a live write is already a conflict
   *
   * The check reads a **remote file**, not "the bytes I wrote". Two transfers onto one
   * file therefore race: A finishes, A starts hashing, B overwrites, and A's read returns
   * B's content. Measured: A reported `verified` after its path was overwritten — a
   * transfer certifying itself with a file that no longer exists anywhere.
   *
   * Two things had to change from the first attempt at this guard:
   *
   * 1. **The identity cannot be the path alone.** `/srv/shared.bin` on host1 and on host2
   *    are different files; keying on the path made unrelated servers collide and turned
   *    a correct check into `indeterminate`. It cannot be the Host row either — two Host
   *    configs may point at one machine, which is the case where a conflict is most
   *    likely and least visible. The key is the connection coordinates plus the
   *    normalised path (see `sftp-transfer-target.ts`).
   *
   * 2. **A write that has started counts, not only one that finished.** A counter bumped
   *    at `done` is blind to B beginning after A's snapshot and still running when A's
   *    read returns. The read claim below is taken *and* the target is inspected while
   *    the check is in flight; a writer that overlaps the check is visible even before its
   *    `done` arrives.
   *
   * When the target is unknown (no connection coordinates on the args) the check cannot
   * decide whether it had a competitor. That is recorded as `indeterminate` — never as
   * `verified`, because "I could not rule out an overwrite" is not a clean bill of health.
   */
  const target = targetOfArgs(args)
  const readHold = target ? beginRead(target) : null
  const targetKey = target ? targetKeyOf(target) : null
  /*
   * Two independent signals, both taken before the read:
   *
   *   - `contendedAtStart`: a writer is running right now. Covers a long write that began
   *     before this check and is still going.
   *   - `completionsAtStart`: how many writes had already finished. A check that sees this
   *     number move later knows a write completed inside its window — the other half of
   *     the race, which a live counter alone cannot see because the writer released its
   *     hold before the check looked.
   */
  const contendedAtStart =
    target !== null && isContended(targetKeyOf(target), 'writers')
  const completionsAtStart = targetKey ? completionsOf(targetKey) : 0

  const task = verifier(id, args)
  // Not verifying this transfer: nothing to hold the session for.
  if (task === null) {
    readHold?.release()
    claim.release()
    return
  }

  verifyingIds.add(id)
  void task
    .catch((error: unknown) => {
      // A verifier that throws must not leave the row reading "computing" forever.
      failChecksum(id, error instanceof Error ? error.message : String(error))
    })
    .then(() => {
      /*
       * Did anything write this target while the check was reading it?
       *
       * `readHold` is still held here, so `writers > 0` means a writer overlapped the
       * check — whether or not it has finished. `contendedAtStart` covers the writer that
       * began before this check and is still going; without it, a long write that started
       * first would be invisible to a short check that ran entirely inside it.
       */
      const contested =
        target === null ||
        contendedAtStart ||
        isContended(targetKeyOf(target), 'writers') ||
        completionsOf(targetKeyOf(target)) > completionsAtStart
      if (contested) {
        useTransferQueue.getState().setChecksumResult(id, 'remote', {
          success: false,
          error:
            target === null
              ? 'This transfer has no server identity, so an overwrite by another ' +
                'transfer cannot be ruled out and the result is not a certification.'
              : 'The file was overwritten or is being written by another transfer, so ' +
                'this result is about different bytes.',
        })
      }
    })
    .finally(() => {
      readHold?.release()
      // The reader releases last, so this is where the target's entry can be reclaimed —
      // otherwise every path the app has ever checked would stay in the map.
      if (targetKey) releaseIfIdle(targetKey)
      verifyingIds.delete(id)
      claim.release()
    })
}
