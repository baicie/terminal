import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SyncPreviewStats } from '@/hooks/use-storage-sync'

interface RestorePreviewProps {
  /** Called to get a fresh preview from the server */
  onPreview: () => Promise<{
    success: boolean
    localCounts?: SyncPreviewStats
    remoteCounts?: SyncPreviewStats
    conflictCounts?: SyncPreviewStats
    error?: string
  }>
  restoreMode: 'merge' | 'replace'
  canPreview: boolean
  onRestore: () => void
  isRestoring: boolean
}

function SyncRow({
  label,
  local,
  remote,
  conflicts,
}: {
  label: string
  local?: number
  remote?: number
  conflicts?: number
}) {
  const hasConflict = conflicts !== undefined && conflicts > 0
  return (
    <div className="flex items-center justify-between text-xs py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-muted-foreground font-mono">{local ?? 0}</span>
        <span className="text-muted-foreground">→</span>
        <span className="font-mono font-medium">{remote ?? 0}</span>
        {hasConflict && (
          <span className="inline-flex items-center px-1 h-4 text-[10px] rounded bg-warning/10 text-warning border border-warning/20">
            {conflicts} conflict{conflicts > 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  )
}

export function RestorePreview({
  onPreview,
  restoreMode,
  canPreview,
  onRestore,
  isRestoring,
}: RestorePreviewProps) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<{
    local?: SyncPreviewStats
    remote?: SyncPreviewStats
    conflicts?: SyncPreviewStats
  } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const loadPreview = async () => {
    setLoading(true)
    setPreviewError(null)
    try {
      const result = await onPreview()
      if (result.success) {
        setPreview({
          local: result.localCounts,
          remote: result.remoteCounts,
          conflicts: result.conflictCounts,
        })
        setExpanded(true)
      } else {
        setPreviewError(result.error ?? 'Unknown error')
      }
    } catch (e) {
      setPreviewError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const totalConflicts = preview?.conflicts
    ? Object.values(preview.conflicts).reduce((a, b) => a + b, 0)
    : 0
  const hasConflicts = totalConflicts > 0

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs h-7"
          disabled={!canPreview || loading || isRestoring}
          onClick={loadPreview}
        >
          {loading ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <CloudDownload className="h-3 w-3 mr-1" />
          )}
          {preview
            ? t('settings.refreshPreview')
            : t('settings.previewChanges')}
        </Button>
        <Button
          variant={hasConflicts ? 'destructive' : 'outline'}
          size="sm"
          className="flex-1 text-xs h-7"
          disabled={!canPreview || !preview || isRestoring}
          onClick={onRestore}
        >
          {isRestoring ? (
            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          ) : (
            <CloudDownload className="h-3 w-3 mr-1" />
          )}
          {t('settings.restoreFromServer')}
        </Button>
      </div>

      {previewError && (
        <p className="text-xs text-destructive">{previewError}</p>
      )}

      {preview && !previewError && (
        <div className="space-y-1">
          {hasConflicts && (
            <div
              className={cn(
                'flex items-center gap-1.5 text-xs px-2 py-1 rounded',
                restoreMode === 'replace'
                  ? 'bg-destructive/10 text-destructive'
                  : 'bg-warning/10 text-warning',
              )}
            >
              <AlertTriangle className="h-3 w-3 shrink-0" />
              <span>
                {restoreMode === 'replace'
                  ? `All local data will be replaced. ${totalConflicts} item${totalConflicts > 1 ? 's' : ''} with the same ID will be overwritten.`
                  : `Merge mode: ${totalConflicts} item${totalConflicts > 1 ? 's' : ''} will be skipped (same ID exists locally).`}
              </span>
            </div>
          )}

          <button
            type="button"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground w-full"
            onClick={() => setExpanded(e => !e)}
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
            <span>{t('settings.conflictDetails') || 'View details'}</span>
          </button>

          {expanded && (
            <div className="pl-4 border-l border-border/50 space-y-0.5">
              <SyncRow
                label="Hosts"
                local={preview.local?.hosts}
                remote={preview.remote?.hosts}
                conflicts={preview.conflicts?.hosts}
              />
              <SyncRow
                label="Groups"
                local={preview.local?.groups}
                remote={preview.remote?.groups}
                conflicts={preview.conflicts?.groups}
              />
              <SyncRow
                label="Snippets"
                local={preview.local?.snippets}
                remote={preview.remote?.snippets}
                conflicts={preview.conflicts?.snippets}
              />
              <SyncRow
                label="SSH Keys"
                local={preview.local?.sshKeys}
                remote={preview.remote?.sshKeys}
                conflicts={preview.conflicts?.sshKeys}
              />
              <SyncRow
                label="Known Hosts"
                local={preview.local?.knownHosts}
                remote={preview.remote?.knownHosts}
                conflicts={preview.conflicts?.knownHosts}
              />
              <SyncRow
                label="Workspaces"
                local={preview.local?.workspaces}
                remote={preview.remote?.workspaces}
                conflicts={preview.conflicts?.workspaces}
              />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
