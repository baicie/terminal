/**
 * 传输之后的完整性校验：两端各算一次 SHA-256，把结果写进传输记录。
 *
 * ## 调用点
 *
 * 只有一处：`sftp-transfer-verify.ts` 在传输 `done`、槽位释放之后通过注入的
 * `TransferVerifier` 调到这里。在此之前这条链是**完整实现、有测试、零调用方** ——
 * 每一次上传下载都以 `checksum: undefined` 结束，「done」在 UI 上和一个真的核对过
 * 两端字节的传输长得一模一样。
 *
 * ## 两侧都要，且分别记录
 *
 * 本地用 Rust 的 `sftp_local_checksum`，远端用 `sftp_remote_checksum`（SFTP 流式
 * 读取，进度通过事件回报）。两侧各写各的状态与错误：一侧失败时另一侧的结论仍然
 * 有效，而「算不出来」必须和「不一样」区分开——判定在
 * `store/transfer-checksum-verdict.ts` 的 `checksumVerdict()` 里。
 *
 * ## 不删除、不修复
 *
 * 校验只产出结论。不匹配时文件留在用户放它的地方：一个校验和差异不足以让应用
 * 自行删除用户的文件，尤其是当它无法判断哪一端才是「对的」的时候。
 */
import { sftpService } from '@/features/terminal/services/sftp'
import { useTransferQueue } from '@/store/transfer-queue'
import type { TransferArgs } from './sftp-transfer-types'

/**
 * 对一次已完成的传输做校验。
 *
 * `transferId` 是记录本身的 id，两侧的进度/结果事件都用它匹配；调用方保证它来自
 * 本次传输的参数，所以旧会话的迟到事件不可能写进别的记录。
 */
export async function verifyChecksum(args: {
  transferId: string
  sessionId: string
  localPath: string
  remotePath: string
}): Promise<void> {
  const { transferId, sessionId, localPath, remotePath } = args

  useTransferQueue.getState().initChecksum(transferId)

  const localResult = await sftpService.checksumLocal(transferId, localPath)
  useTransferQueue.getState().setChecksumResult(transferId, 'local', {
    success: localResult.success,
    hash: localResult.hash,
    error: localResult.message,
  })

  const remoteResult = await sftpService.checksumRemote(
    transferId,
    sessionId,
    remotePath,
  )
  useTransferQueue.getState().setChecksumResult(transferId, 'remote', {
    success: remoteResult.success,
    hash: remoteResult.hash,
    error: remoteResult.message,
  })
}


/**
 * 生产校验器：队列在每次传输 `done` 之后调用它。
 *
 * `id` 是队列分配的 transferId，也是这条记录的唯一身份——两侧的进度与结果事件都
 * 用它匹配，所以重复传输、并发传输之间不会串。
 */
export function createTransferVerifier() {
  return (id: string, args: TransferArgs) =>
    verifyChecksum({
      transferId: id,
      sessionId: args.sessionId,
      localPath: args.localPath,
      remotePath: args.remotePath,
    })
}
