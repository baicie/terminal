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
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import type { ImportMode, ImportPreview } from './export-import-operations'

export function ExportImportContent({
  exporting,
  importMode,
  preview,
  content,
  step,
  errorMessage,
  onExport,
  onSelect,
  onModeChange,
  onReset,
  onImport,
}: {
  exporting: boolean
  importMode: ImportMode
  preview: ImportPreview | null
  content: string | null
  step: string
  errorMessage: string | null
  onExport: () => void
  onSelect: () => void
  onModeChange: (mode: ImportMode) => void
  onReset: () => void
  onImport: () => void
}) {
  const entries = [
    ['hosts', 'host(s)'],
    ['groups', 'group(s)'],
    ['snippets', 'snippet(s)'],
    ['snippetPackages', 'snippet package(s)'],
    ['sshKeys', 'SSH key(s)'],
    ['workspaces', 'workspace(s)'],
    ['knownHosts', 'known host(s)'],
  ] as const
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
          onClick={onExport}
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
        {step === 'idle' && (
          <Button variant="outline" onClick={onSelect} className="w-full">
            <Upload className="h-4 w-4 mr-2" />
            Select Import File
          </Button>
        )}
        {step === 'preview' && preview && (
          <div className="space-y-3 p-3 bg-muted rounded-lg">
            <p className="text-sm font-medium">Import Preview:</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              {entries.map(
                ([key, label], index) =>
                  (index < 3 || preview[key] > 0) && (
                    <li key={key}>
                      <Check className="h-3 w-3 inline mr-1 text-green-500" />
                      {preview[key]} {label}
                    </li>
                  ),
              )}
            </ul>
            <div className="space-y-2 pt-2">
              <Label className="text-xs">Import Mode</Label>
              <div className="flex gap-2">
                <Button
                  variant={importMode === 'merge' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onModeChange('merge')}
                  className="flex-1"
                >
                  <Merge className="h-3 w-3 mr-1" />
                  Merge
                </Button>
                <Button
                  variant={importMode === 'replace' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onModeChange('replace')}
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
                onClick={onReset}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={onImport}
                disabled={!content}
                className="flex-1"
              >
                <Upload className="h-3 w-3 mr-1" />
                Import
              </Button>
            </div>
          </div>
        )}
        {step === 'importing' && (
          <div className="text-center py-4">
            <RefreshCw className="h-6 w-6 mx-auto animate-spin text-primary" />
            <p className="mt-2 text-sm">Importing data...</p>
          </div>
        )}
        {step === 'success' && (
          <div className="text-center py-4">
            <div className="h-8 w-8 mx-auto rounded-full bg-green-100 flex items-center justify-center">
              <Check className="h-5 w-5 text-green-600" />
            </div>
            <p className="mt-2 text-sm">Import successful!</p>
          </div>
        )}
        {step === 'error' && (
          <div className="space-y-2">
            <div className="p-3 bg-destructive/10 rounded-lg flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{errorMessage}</p>
            </div>
            <Button variant="outline" onClick={onReset} className="w-full">
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
