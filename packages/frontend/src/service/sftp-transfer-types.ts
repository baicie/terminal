export interface SftpProgressPayload {
  transferId: string
  kind:
    | 'progress'
    | 'done'
    | 'error'
    | 'checksum-start'
    | 'checksum-progress'
    | 'checksum-done'
  bytesDone: number
  bytesTotal: number
  message?: string | null
  side?: string | null
}

/**
 * 传输目标：连接坐标 + 远端路径。
 *
 * `sessionId` 是随机 UUID，两条到同一台机器的会话之间没有可比较的东西；Host 行的 id
 * 也不行 —— 同一个服务器可以有多条 Host 配置。真正决定「这是不是同一个文件」的是
 * **主机名、端口、账号与路径**，这四样合起来才是目标身份。
 */
export interface TransferTarget {
  hostname: string
  port: number
  username: string
  remotePath: string
}

interface TransferCommon {
  sessionId: string
  displayName?: string
  bytesTotal?: number
  /**
   * Where this transfer is going, when the caller knows.
   *
   * Optional because the admission layer is also used by tests and by paths that only
   * have a session id. **Absent is not "no conflict"**: the integrity check degrades to
   * `indeterminate` when it cannot decide whether a competitor existed.
   */
  target?: TransferTarget
}

export type TransferArgs =
  | (TransferCommon & {
      kind: 'upload'
      localPath: string
      remotePath: string
    })
  | (TransferCommon & {
      kind: 'download'
      remotePath: string
      localPath: string
    })
