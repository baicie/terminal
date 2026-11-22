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

  const task = verifier(id, args)
  // Not verifying this transfer: nothing to hold the session for.
  if (task === null) {
    claim.release()
    return
  }

  verifyingIds.add(id)
  void task
    .catch((error: unknown) => {
      // A verifier that throws must not leave the row reading "computing" forever.
      failChecksum(id, error instanceof Error ? error.message : String(error))
    })
    .finally(() => {
      verifyingIds.delete(id)
      claim.release()
    })
}
