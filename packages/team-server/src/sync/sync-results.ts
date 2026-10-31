export interface ConflictInfo {
  shareId: string
  localVersion: { updatedAt: number; data: unknown }
  remoteVersion: { updatedAt: number; data: unknown; updatedBy: string }
}

export interface PushResult {
  created: string[]
  updated: string[]
  deleted: string[]
  conflicts: string[]
  errors: Array<{ id: string, error: string }>
}

export interface ShareSnapshot {
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
  /** Server-issued monotonic version; the client echoes it back as baseVersion. */
  version: number
}

export interface IncrementalSyncResult {
  /** Opaque server cursor (safe watermark) the client must send back unchanged. */
  cursor: number
  /** Legacy alias of cursor kept for older clients and for logging. */
  timestamp: number
  /** True when the cursor was unusable and this response is a full snapshot. */
  resync: boolean
  shares: ShareSnapshot[]
  deletedShareIds: string[]
}
