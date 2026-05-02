import { readTextFile } from '@tauri-apps/plugin-fs'
import {
  AlertCircle,
  Check,
  Download,
  Merge,
  RefreshCw,
  Replace,
  Shield,
  Upload,
} from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/sonner'
import { executeQuery, select } from '@/service/database'
import { exportDataToFile, previewImportData } from '@/service/sync'
import type { ExportData } from '@/service/sync'

type ImportStep = 'idle' | 'preview' | 'importing' | 'success' | 'error'

interface ImportPreview {
  hosts: number
  groups: number
  snippets: number
  snippetPackages: number
  workspaces: number
  sshKeys: number
  knownHosts: number
}

interface ExportImportSettingsProps {
  onClose?: () => void
}

export function ExportImportSettings({ onClose }: ExportImportSettingsProps) {
  const [exporting, setExporting] = useState(false)
  const [importMode, setImportMode] = useState<'merge' | 'replace'>('merge')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importContent, setImportContent] = useState<string | null>(null)
  const [importStep, setImportStep] = useState<ImportStep>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

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
      const filePath = await exportDataToFile()
      if (filePath) {
        toast.success('Export successful', { description: filePath })
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
      const { open } = await import('@tauri-apps/plugin-dialog')
      const selected = await open({
        multiple: false,
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (selected) {
        const content = await readTextFile(selected as string)
        const preview = previewImportData(content)

        if (preview) {
          setImportContent(content)
          setImportPreview({
            hosts: preview.hosts?.length || 0,
            groups: preview.groups?.length || 0,
            snippets: preview.snippets?.length || 0,
            snippetPackages: preview.snippetPackages?.length || 0,
            workspaces: (preview.workspaces as unknown[])?.length || 0,
            sshKeys: (preview.sshKeys as unknown[])?.length || 0,
            knownHosts: (preview.knownHosts as unknown[])?.length || 0,
          })
          setImportStep('preview')
        } else {
          setErrorMessage('Invalid export file format')
          setImportStep('error')
        }
      }
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

      // Import SSH Keys
      if (data.sshKeys && data.sshKeys.length > 0) {
        for (const key of data.sshKeys as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            'SELECT id FROM ssh_keys WHERE id = ?',
            [key.id as string],
          )
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO ssh_keys (id, name, key_type, private_key, public_key, certificate, passphrase, is_encrypted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                key.id,
                key.name,
                key.key_type,
                key.private_key,
                key.public_key,
                key.certificate,
                key.passphrase,
                key.is_encrypted,
                key.created_at,
                key.updated_at,
              ],
            )
          } else if (importMode === 'replace') {
            await executeQuery(
              `UPDATE ssh_keys SET name = ?, key_type = ?, private_key = ?, public_key = ?, certificate = ?, passphrase = ?, is_encrypted = ?, updated_at = ? WHERE id = ?`,
              [
                key.name,
                key.key_type,
                key.private_key,
                key.public_key,
                key.certificate,
                key.passphrase,
                key.is_encrypted,
                Date.now(),
                key.id,
              ],
            )
          }
        }
      }

      // Import Known Hosts
      if (data.knownHosts && data.knownHosts.length > 0) {
        for (const knownHost of data.knownHosts as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            'SELECT id FROM known_hosts WHERE hostname = ? AND port = ?',
            [knownHost.hostname as string, knownHost.port as number],
          )
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO known_hosts (id, hostname, port, fingerprint, key_type, added_at) VALUES (?, ?, ?, ?, ?, ?)`,
              [
                crypto.randomUUID(),
                knownHost.hostname,
                knownHost.port,
                knownHost.fingerprint,
                knownHost.key_type,
                knownHost.added_at,
              ],
            )
          }
        }
      }

      // Import Workspaces
      if (data.workspaces && data.workspaces.length > 0) {
        for (const workspace of data.workspaces as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            'SELECT id FROM workspaces WHERE id = ?',
            [workspace.id as string],
          )
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO workspaces (id, name, description, icon, color, "order", is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                workspace.id,
                workspace.name,
                workspace.description,
                workspace.icon,
                workspace.color,
                workspace.order,
                workspace.is_active,
                workspace.created_at,
                workspace.updated_at,
              ],
            )
          } else if (importMode === 'replace') {
            await executeQuery(
              `UPDATE workspaces SET name = ?, description = ?, icon = ?, color = ?, "order" = ?, is_active = ?, updated_at = ? WHERE id = ?`,
              [
                workspace.name,
                workspace.description,
                workspace.icon,
                workspace.color,
                workspace.order,
                workspace.is_active,
                Date.now(),
                workspace.id,
              ],
            )
          }
        }
      }

      // Import Workspace Layouts
      if (data.workspaceLayouts && data.workspaceLayouts.length > 0) {
        for (const wl of data.workspaceLayouts as Record<string, unknown>[]) {
          const layoutData = wl.layoutData as Record<string, unknown> | null
          if (layoutData) {
            await executeQuery(
              `INSERT OR REPLACE INTO workspace_layouts (workspace_id, layout_data) VALUES (?, ?)`,
              [wl.workspaceId as string, JSON.stringify(layoutData)],
            )
          }
        }
      }

      setImportStep('success')
      setTimeout(() => {
        onClose?.()
      }, 1500)
    } catch (error) {
      console.error('Import failed:', error)
      setErrorMessage(`Import failed: ${error}`)
      setImportStep('error')
    }
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <Shield className="h-4 w-4" />
        Local Export / Import
      </h4>
      <p className="text-sm text-muted-foreground">
        Export or import your data as a JSON file. This works independently of
        team mode.
      </p>

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Export all hosts, groups, snippets, and settings to a JSON file for
          backup.
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
              Exporting...
            </>
          ) : (
            <>
              <Download className="h-4 w-4 mr-2" />
              Export to JSON File
            </>
          )}
        </Button>
      </div>

      <Separator />

      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Import data from a JSON export file. Supports both full exports and
          team packages.
        </p>

        {importStep === 'idle' && (
          <Button
            variant="outline"
            onClick={handleSelectImportFile}
            className="w-full"
          >
            <Upload className="h-4 w-4 mr-2" />
            Select Import File
          </Button>
        )}

        {importStep === 'preview' && importPreview && (
          <div className="space-y-3 p-3 bg-muted rounded-lg">
            <p className="text-sm font-medium">Import Preview:</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>
                <Check className="h-3 w-3 inline mr-1 text-green-500" />
                {importPreview.hosts} host(s)
              </li>
              <li>
                <Check className="h-3 w-3 inline mr-1 text-green-500" />
                {importPreview.groups} group(s)
              </li>
              <li>
                <Check className="h-3 w-3 inline mr-1 text-green-500" />
                {importPreview.snippets} snippet(s)
              </li>
              {importPreview.snippetPackages > 0 && (
                <li>
                  <Check className="h-3 w-3 inline mr-1 text-green-500" />
                  {importPreview.snippetPackages} snippet package(s)
                </li>
              )}
              {importPreview.sshKeys > 0 && (
                <li>
                  <Check className="h-3 w-3 inline mr-1 text-green-500" />
                  {importPreview.sshKeys} SSH key(s)
                </li>
              )}
              {importPreview.workspaces > 0 && (
                <li>
                  <Check className="h-3 w-3 inline mr-1 text-green-500" />
                  {importPreview.workspaces} workspace(s)
                </li>
              )}
              {importPreview.knownHosts > 0 && (
                <li>
                  <Check className="h-3 w-3 inline mr-1 text-green-500" />
                  {importPreview.knownHosts} known host(s)
                </li>
              )}
            </ul>

            <div className="space-y-2 pt-2">
              <Label className="text-xs">Import Mode</Label>
              <div className="flex gap-2">
                <Button
                  variant={importMode === 'merge' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setImportMode('merge')}
                  className="flex-1"
                >
                  <Merge className="h-3 w-3 mr-1" />
                  Merge
                </Button>
                <Button
                  variant={importMode === 'replace' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setImportMode('replace')}
                  className="flex-1"
                >
                  <Replace className="h-3 w-3 mr-1" />
                  Replace
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {importMode === 'merge'
                  ? 'New items will be added, existing items will be kept.'
                  : 'Existing items with the same ID will be overwritten.'}
              </p>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={resetSyncState}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button size="sm" onClick={handleImport} className="flex-1">
                <Upload className="h-3 w-3 mr-1" />
                Import
              </Button>
            </div>
          </div>
        )}

        {importStep === 'importing' && (
          <div className="text-center py-4">
            <RefreshCw className="h-6 w-6 mx-auto animate-spin text-primary" />
            <p className="mt-2 text-sm">Importing data...</p>
          </div>
        )}

        {importStep === 'success' && (
          <div className="text-center py-4">
            <div className="h-8 w-8 mx-auto rounded-full bg-green-100 flex items-center justify-center">
              <Check className="h-5 w-5 text-green-600" />
            </div>
            <p className="mt-2 text-sm">Import successful!</p>
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
              Try Again
            </Button>
          </div>
        )}
      </div>

      <div className="p-3 bg-muted/50 rounded-lg flex items-start gap-2">
        <Shield className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          Data is exported as plain JSON. Sensitive information like passwords
          may be included. Keep your export files secure.
        </p>
      </div>
    </div>
  )
}
