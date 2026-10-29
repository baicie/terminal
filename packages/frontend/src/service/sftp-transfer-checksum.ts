import { sftpService } from '@/features/terminal/services/sftp'
import { useTransferQueue } from '@/store/transfer-queue'

/**
 * 验证传输完整性：对本地文件和远端文件分别计算 SHA-256，
 * 然后比对两端的 hash 值。
 *
 * 调用流程：
 * 1. 本地文件：直接用 Rust 计算本地 checksum
 * 2. 远端文件：Rust SFTP 流式读取计算 checksum，事件通知前端
 * 3. 两端 hash 都在 TransferRecord.checksum 中，自动比对
 *
 * 调用方需要监听 TransferQueue 的变化来获取最终比对结果。
 */
export async function verifyChecksum(args: {
  transferId: string
  sessionId: string
  localPath: string
  remotePath: string
}): Promise<void> {
  const { transferId, sessionId, localPath, remotePath } = args

  // 初始化 checksum 状态
  useTransferQueue.getState().initChecksum(transferId)

  // 并行计算本地和远端 hash
  const [localResult] = await Promise.all([
    // 本地 checksum：直接调用 Rust
    sftpService.checksumLocal(transferId, localPath),
  ])

  // 本地结果立即写入
  useTransferQueue.getState().setChecksumResult(transferId, 'local', {
    success: localResult.success,
    hash: localResult.hash,
    error: localResult.message,
  })

  // 远端 checksum：通过 SFTP 流式读取，进度通过事件通知
  // 必须用原始 transferId 以便事件监听器匹配
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
