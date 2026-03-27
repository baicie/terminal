import type { AppSettings } from '@/service/database'
import type { ExportData } from '@/service/sync'
import {
  AlertCircle,
  Check,
  Download,
  Merge,
  Package,
  RefreshCw,
  Replace,
  Shield,
  Upload,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/sonner'
import {
  executeQuery,
  getAppSettings,
  select,
} from '@/service/database'

type ImportStep = 'idle' | 'preview' | 'importing' | 'success' | 'error'

interface ImportPreview {
  hosts: number
  groups: number
  snippets: number
  snippetPackages: number
  workspaces: number
}

interface DataSettingsProps {
  settings: AppSettings
}

export const DataSettings: React.FC<DataSettingsProps> = ({ settings }) => {
  const { t } = useTranslation()
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importContent, setImportContent] = useState<string | null>(null)
  const [importStep, setImportStep] = useState<ImportStep>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const resetSyncState = () => {
    setImportStep('idle')
    setImportPreview(null)
    setImportContent(null)
    setErrorMessage(null)
    setImportMode('merge')
  }

  const handleExport = async () => {
    setExporting(true)
    setErrorMessage(null)
    try {
      const { exportDataToFile } = await import('@/service/sync')
      const filePath = await exportDataToFile()
      if (filePath) {
        toast.success(t('settings.exportSuccess'), { description: filePath })
      }
    } catch (error) {
      console.error('Export failed:', error)
      setErrorMessage(`Export failed: ${error}`)
    } finally {
      setExporting(false)
    }
  }

  const handleSelectImportFile = async () => {
    try {
      setImportStep('idle')
      toast.info(t('settings.fileSelectDesc'))
    } catch (error) {
      console.error('Failed to read file:', error)
      setErrorMessage(`Failed to read file: ${error}`)
      setImportStep('error')
    }
  }

  const handleImport = async () => {
    if (!importContent) return

    setImportStep('importing')

    try {
      const data: ExportData = JSON.parse(importContent)

      if (data.groups && data.groups.length > 0) {
        for (const group of data.groups as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            'SELECT id FROM groups WHERE id = ?',
            [group.id as string],
          )
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO groups (id, name, parent_id, color, inherit_settings, settings, "order") VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                group.id,
                group.name,
                group.parent_id,
                group.color,
                group.inherit_settings,
                group.settings,
                group.order,
              ],
            )
          } else if (importMode === 'replace') {
            await executeQuery(
              `UPDATE groups SET name = ?, parent_id = ?, color = ?, inherit_settings = ?, settings = ?, "order" = ? WHERE id = ?`,
              [
                group.name,
                group.parent_id,
                group.color,
                group.inherit_settings,
                group.settings,
                group.order,
                group.id,
              ],
            )
          }
        }
      }

      if (data.hosts && data.hosts.length > 0) {
        for (const host of data.hosts as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            'SELECT id FROM hosts WHERE id = ?',
            [host.id as string],
          )
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO hosts (id, name, hostname, port, username, auth_type, password, private_key, group_id, is_favorite, color, tags, port_forwards, startup_command, environment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                host.id,
                host.name,
                host.hostname,
                host.port,
                host.username,
                host.auth_type,
                host.password,
                host.private_key,
                host.group_id,
                host.is_favorite,
                host.color,
                host.tags,
                host.port_forwards,
                host.startup_command,
                host.environment,
                host.created_at,
                host.updated_at,
              ],
            )
          } else if (importMode === 'replace') {
            await executeQuery(
              `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = ?, private_key = ?, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, updated_at = ? WHERE id = ?`,
              [
                host.name,
                host.hostname,
                host.port,
                host.username,
                host.auth_type,
                host.password,
                host.private_key,
                host.group_id,
                host.is_favorite,
                host.color,
                host.tags,
                host.port_forwards,
                host.startup_command,
                host.environment,
                Date.now(),
                host.id,
              ],
            )
          }
        }
      }

      if (data.snippets && data.snippets.length > 0) {
        for (const snippet of data.snippets as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            'SELECT id FROM snippets WHERE id = ?',
            [snippet.id as string],
          )
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO snippets (id, name, description, script, package_id, tags, variables) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                snippet.id,
                snippet.name,
                snippet.description,
                snippet.script,
                snippet.package_id,
                snippet.tags,
                snippet.variables,
              ],
            )
          } else if (importMode === 'replace') {
            await executeQuery(
              `UPDATE snippets SET name = ?, description = ?, script = ?, package_id = ?, tags = ?, variables = ? WHERE id = ?`,
              [
                snippet.name,
                snippet.description,
                snippet.script,
                snippet.package_id,
                snippet.tags,
                snippet.variables,
                snippet.id,
              ],
            )
          }
        }
      }

      if (data.snippetPackages && data.snippetPackages.length > 0) {
        for (const pkg of data.snippetPackages as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            'SELECT id FROM snippet_packages WHERE id = ?',
            [pkg.id as string],
          )
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO snippet_packages (id, name, description) VALUES (?, ?, ?)`,
              [pkg.id, pkg.name, pkg.description],
            )
          } else if (importMode === 'replace') {
            await executeQuery(
              `UPDATE snippet_packages SET name = ?, description = ? WHERE id = ?`,
              [pkg.name, pkg.description, pkg.id],
            )
          }
        }
      }

      setImportStep('success')
      setTimeout(() => {
        resetSyncState()
      }, 1500)
    } catch (error) {
      console.error('Import failed:', error)
      setErrorMessage(`Import failed: ${error}`)
      setImportStep('error')
    }
  }

  return (
    <div className="space-y-6">
      {/* Export Data */}
      <div className="bg-card rounded-lg border p-4 space-y-4">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Package className="h-4 w-4" />
          {t('settings.exportData')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('settings.exportDesc')}
        </p>
        <Button
          variant="outline"
          onClick={handleExport}
          disabled={exporting}
          className="w-full"
        >
          {exporting ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              {t('settings.exporting')}
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              {t('settings.exportJson')}
            </>
          )}
        </Button>
      </div>

      {/* Import Data */}
      <div className="bg-card rounded-lg border p-4 space-y-4">
        <h3 className="text-sm font-medium flex items-center gap-2">
          <Upload className="h-4 w-4" />
          {t('settings.importData')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t('settings.importDesc')}
        </p>

        {importStep === 'idle' && (
          <Button
            variant="outline"
            onClick={handleSelectImportFile}
            className="w-full"
          >
            <Upload className="h-4 w-4 mr-2" />
            {t('settings.selectImportFile')}
          </Button>
        )}

        {importStep === 'preview' && importPreview && (
          <div className="space-y-3 p-3 bg-muted rounded-lg">
            <p className="text-sm font-medium">{t('settings.importPreview')}</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>
                <Check className="h-3 w-3 inline mr-1 text-green-500" />
                {t('settings.hosts', { count: importPreview.hosts })}
              </li>
              <li>
                <Check className="h-3 w-3 inline mr-1 text-green-500" />
                {t('settings.groups', { count: importPreview.groups })}
              </li>
              <li>
                <Check className="h-3 w-3 inline mr-1 text-green-500" />
                {t('settings.snippets', { count: importPreview.snippets })}
              </li>
              {importPreview.snippetPackages > 0 && (
                <li>
                  <Check className="h-3 w-3 inline mr-1 text-green-500" />
                  {t('settings.snippetPackages', {
                    count: importPreview.snippetPackages,
                  })}
                </li>
              )}
            </ul>

            <div className="space-y-2 pt-2">
              <Label className="text-xs">{t('settings.importMode')}</Label>
              <div className="flex gap-2">
                <Button
                  variant={importMode === 'merge' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setImportMode('merge')}
                  className="flex-1"
                >
                  <Merge className="h-3 w-3 mr-1" />
                  {t('settings.merge')}
                </Button>
                <Button
                  variant={importMode === 'replace' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setImportMode('replace')}
                  className="flex-1"
                >
                  <Replace className="h-3 w-3 mr-1" />
                  {t('settings.replace')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {importMode === 'merge'
                  ? t('settings.mergeDesc')
                  : t('settings.replaceDesc')}
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={resetSyncState}
                className="flex-1"
              >
                {t('common.cancel')}
              </Button>
              <Button size="sm" onClick={handleImport} className="flex-1">
                <Upload className="h-3 w-3 mr-1" />
                {t('settings.import')}
              </Button>
            </div>
          </div>
        )}

        {importStep === 'importing' && (
          <div className="text-center py-4">
            <RefreshCw className="h-6 w-6 mx-auto animate-spin text-primary" />
            <p className="mt-2 text-sm">{t('settings.importing')}</p>
          </div>
        )}

        {importStep === 'success' && (
          <div className="text-center py-4">
            <div className="h-8 w-8 mx-auto rounded-full bg-green-100 flex items-center justify-center">
              <Check className="h-5 w-5 text-green-600" />
            </div>
            <p className="mt-2 text-sm">{t('settings.importSuccess')}</p>
          </div>
        )}

        {importStep === 'error' && (
          <div className="space-y-2">
            <div className="p-3 bg-destructive/10 rounded-lg flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{errorMessage}</p>
            </div>
            <Button
              variant="outline"
              onClick={resetSyncState}
              className="w-full"
            >
              {t('settings.tryAgain')}
            </Button>
          </div>
        )}
      </div>

      <div className="p-3 bg-muted/50 rounded-lg flex items-start gap-2">
        <Shield className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          {t('settings.securityWarning')}
        </p>
      </div>
    </div>
  )
}
