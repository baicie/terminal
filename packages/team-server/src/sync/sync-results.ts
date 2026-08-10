export interface ConflictInfo {
  shareId: string
  localVersion: { updatedAt: number; data: unknown }
  remoteVersion: { updatedAt: number; data: unknown; updatedBy: string }
}

export interface IncrementalSyncResult {
  timestamp: number
  shares: Array<{
    id: string
    teamId: string
    type: string
    data: unknown
    encryptedData: string | null
    isSensitive: boolean
    sharedBy: string
    permission: string
    createdAt: string
    updatedAt: string
  }>
  deletedShareIds: string[]
}
