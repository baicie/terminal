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
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
  const entries = [
    ['hosts', 'settings.hosts'],
    ['groups', 'settings.groups'],
    ['snippets', 'settings.snippets'],
    ['snippetPackages', 'settings.snippetPackages'],
    ['sshKeys', 'settings.sshKeys'],
    ['workspaces', 'settings.workspaces'],
    ['knownHosts', 'settings.knownHosts'],
  ] as const
  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium flex items-center gap-2">
        <Shield className="size-4" />
        {t('settings.localExportImport')}
      </h4>
      <p className="text-sm text-muted-foreground">
        {t('settings.exportImportDesc')}
      </p>
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {t('settings.exportDesc')}
        </p>
        <Button
          variant="outline"
          onClick={onExport}
          disabled={exporting}
          className="w-full"
        >
          {exporting ? (
            <>
              <RefreshCw className="size-4 mr-2 animate-spin" />
              {t('settings.exporting')}
            </>
          ) : (
            <>
              <Download className="size-4 mr-2" />
              {t('settings.exportJson')}
            </>
          )}
        </Button>
      </div>
      <Separator />
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          {t('settings.importFromFileDesc')}
        </p>
        {step === 'idle' && (
          <Button variant="outline" onClick={onSelect} className="w-full">
            <Upload className="size-4 mr-2" />
            {t('settings.selectImportFile')}
          </Button>
        )}
        {step === 'preview' && preview && (
          <div className="space-y-3 p-3 bg-muted rounded-lg">
            <p className="text-sm font-medium">{t('settings.importPreview')}</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              {entries.map(
                ([key, label], index) =>
                  (index < 3 || preview[key] > 0) && (
                    <li key={key}>
                      <Check className="size-3 inline mr-1 text-green-500" />
                      {t(label, { count: preview[key] })}
                    </li>
                  ),
              )}
            </ul>
            <div className="space-y-2 pt-2">
              <Label className="text-xs">{t('settings.importMode')}</Label>
              <div className="flex gap-2">
                <Button
                  variant={importMode === 'merge' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onModeChange('merge')}
                  className="flex-1"
                >
                  <Merge className="size-3 mr-1" />
                  {t('settings.merge')}
                </Button>
                <Button
                  variant={importMode === 'replace' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => onModeChange('replace')}
                  className="flex-1"
                >
                  <Replace className="size-3 mr-1" />
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
                onClick={onReset}
                className="flex-1"
              >
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={onImport}
                disabled={!content}
                className="flex-1"
              >
                <Upload className="size-3 mr-1" />
                {t('settings.import')}
              </Button>
            </div>
          </div>
        )}
        {step === 'importing' && (
          <div className="text-center py-4">
            <RefreshCw className="size-6 mx-auto animate-spin text-primary" />
            <p className="mt-2 text-sm">{t('settings.importing')}</p>
          </div>
        )}
        {step === 'success' && (
          <div className="text-center py-4">
            <div className="size-8 mx-auto rounded-full bg-green-100 flex items-center justify-center">
              <Check className="size-5 text-green-600" />
            </div>
            <p className="mt-2 text-sm">{t('settings.importSuccess')}</p>
          </div>
        )}
        {step === 'error' && (
          <div className="space-y-2">
            <div className="p-3 bg-destructive/10 rounded-lg flex items-start gap-2">
              <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-sm text-destructive">{errorMessage}</p>
            </div>
            <Button variant="outline" onClick={onReset} className="w-full">
              {t('settings.tryAgain')}
            </Button>
          </div>
        )}
      </div>
      <div className="p-3 bg-muted/50 rounded-lg flex items-start gap-2">
        <Shield className="size-4 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-xs text-muted-foreground">
          Data is exported as plain JSON. Sensitive information like passwords
          may be included. Keep your export files secure.
        </p>
      </div>
    </div>
  )
}
