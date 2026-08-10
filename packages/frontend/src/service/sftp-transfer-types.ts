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

export type TransferArgs =
  | {
      kind: 'upload'
      sessionId: string
      localPath: string
      remotePath: string
      displayName?: string
      bytesTotal?: number
    }
  | {
      kind: 'download'
      sessionId: string
      remotePath: string
      localPath: string
      displayName?: string
      bytesTotal?: number
    }
