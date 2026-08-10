export interface BatchExecutionResult {
  hostId: string
  hostName: string
  hostAddress: string
  status: 'success' | 'failed' | 'timeout'
  output?: string
  error?: string
  durationMs: number
}

export interface ScriptExecutionResult {
  success: boolean
  results: BatchExecutionResult[]
  totalHosts: number
  successCount: number
  failedCount: number
}
