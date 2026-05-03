import { useCallback, useEffect, useState } from 'react'
import { toast } from '@/components/ui/sonner'
import {
  downloadFromServer,
  formatLastSyncTime,
  previewServerData,
  syncToServer,
} from '@/service/sync'
import { storageHealthCheck, storageInit } from '@/service/storage'

export interface StorageServiceConfig {
  type: 'webdav' | 's3' | 'custom'
  endpoint: string
  username?: string
  password?: string
  bucket?: string
  region?: string
}

export interface SyncPreviewStats {
  hosts: number
  groups: number
  snippets: number
  snippetPackages: number
  sshKeys: number
  knownHosts: number
  workspaces: number
}

export interface SyncPreviewResult {
  success: boolean
  localCounts?: SyncPreviewStats
  remoteCounts?: SyncPreviewStats
  conflictCounts?: SyncPreviewStats
  error?: string
}

export interface UseStorageSyncOptions {
  /** Lazy import to avoid circular deps */
  getConfig: () => StorageServiceConfig | null
}

export function useStorageSync({ getConfig }: UseStorageSyncOptions) {
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [syncing, setSyncing] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null)

  // Update last sync time display periodically
  useEffect(() => {
    const updateSyncTime = () => setLastSyncTime(formatLastSyncTime())
    updateSyncTime()
    const interval = setInterval(updateSyncTime, 60_000)
    return () => clearInterval(interval)
  }, [])

  const initService = useCallback(async (): Promise<boolean> => {
    const config = getConfig()
    if (!config?.endpoint) return false

    await storageInit(config.type, config.endpoint, {
      username: config.username,
      password: config.password,
      bucket: config.bucket,
      region: config.region,
    })
    return true
  }, [getConfig])

  const handleTestConnection = useCallback(async (): Promise<void> => {
    if (!(await initService())) return

    setTestingConnection(true)
    setConnectionStatus('idle')
    try {
      const healthy = await storageHealthCheck()
      setConnectionStatus(healthy ? 'success' : 'error')
    } catch {
      setConnectionStatus('error')
    } finally {
      setTestingConnection(false)
    }
  }, [initService])

  const handleSyncToServer = useCallback(async (): Promise<void> => {
    if (!(await initService())) return

    setSyncing(true)
    try {
      const result = await syncToServer()
      if (result.success) {
        setLastSyncTime(formatLastSyncTime())
        toast.success('Sync successful', {
          description: `${result.stats?.hosts ?? 0} hosts, ${result.stats?.snippets ?? 0} snippets, ${result.stats?.workspaces ?? 0} workspaces`,
        })
      } else {
        toast.error('Sync failed', {
          description: result.stats ? undefined : 'No backup found on server',
        })
      }
    } catch (error) {
      toast.error('Sync failed', { description: String(error) })
    } finally {
      setSyncing(false)
    }
  }, [initService])

  const handleRestoreFromServer = useCallback(async (restoreMode: 'merge' | 'replace'): Promise<void> => {
    if (!(await initService())) return

    setRestoring(true)
    try {
      const result = await downloadFromServer(restoreMode)
      if (result.success && result.stats) {
        setLastSyncTime(formatLastSyncTime())
        toast.success('Restore successful', {
          description: `${result.stats.hosts} hosts, ${result.stats.snippets} snippets, ${result.stats.workspaces} workspaces`,
        })
      } else {
        toast.error('Restore failed', { description: 'No backup found on server' })
      }
    } catch (error) {
      toast.error('Restore failed', { description: String(error) })
    } finally {
      setRestoring(false)
    }
  }, [initService])

  const handlePreviewServerData = useCallback(async (): Promise<SyncPreviewResult> => {
    if (!(await initService())) {
      return { success: false, error: 'No endpoint configured' }
    }
    try {
      const result = await previewServerData()
      if (result.success && result.localCounts) {
        return {
          success: true,
          localCounts: result.localCounts,
          remoteCounts: result.remoteCounts,
          conflictCounts: result.conflictCounts,
        }
      }
      return { success: false, error: result.error ?? 'Failed to preview data' }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  }, [initService])

  const isSyncDisabled = useCallback((): boolean => {
    const config = getConfig()
    return !config?.endpoint || syncing || restoring || connectionStatus !== 'success'
  }, [getConfig, syncing, restoring, connectionStatus])

  return {
    testingConnection,
    connectionStatus,
    syncing,
    restoring,
    lastSyncTime,
    handleTestConnection,
    handleSyncToServer,
    handleRestoreFromServer,
    handlePreviewServerData,
    isSyncDisabled,
  }
}
