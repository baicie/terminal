import { Check, Merge, Replace, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import type { ImportSecretsDiagnosis } from '@/service/sync'
import { ImportSecretsPanel } from './import-secrets-panel'
import type { ImportMode, ImportPreview } from './export-import-operations'

const ENTRIES = [
  ['hosts', 'settings.hosts'],
  ['groups', 'settings.groups'],
  ['snippets', 'settings.snippets'],
  ['snippetPackages', 'settings.snippetPackages'],
  ['sshKeys', 'settings.sshKeys'],
  ['workspaces', 'settings.workspaces'],
  ['knownHosts', 'settings.knownHosts'],
] as const

/**
 * The import preview: what the file holds, how it merges, and — when the file
 * carries plaintext — the decision that replaces the Import button.
 *
 * Its own component because that decision is a data outcome, not a confirmation,
 * and the surrounding panel should not be able to render an Import button that
 * bypasses it.
 */
export function ImportPreviewCard({
  importMode,
  preview,
  content,
  secrets,
  onModeChange,
  onReset,
  onImport,
  onMigrateSecrets,
  onDiscardSecrets,
  onCancelSecrets,
}: {
  importMode: ImportMode
  preview: ImportPreview
  content: string | null
  secrets: ImportSecretsDiagnosis | null
  onModeChange: (mode: ImportMode) => void
  onReset: () => void
  onImport: () => void
  onMigrateSecrets: () => void
  onDiscardSecrets: () => void
  onCancelSecrets: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-3 p-3 bg-muted rounded-lg">
      <p className="text-sm font-medium">{t('settings.importPreview')}</p>
      <ul className="text-sm text-muted-foreground space-y-1">
        {ENTRIES.map(
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
        <Button variant="outline" size="sm" onClick={onReset} className="flex-1">
          {t('common.cancel')}
        </Button>
        <Button
          size="sm"
          onClick={onImport}
          disabled={!content || Boolean(secrets?.needsDecision)}
          className="flex-1"
        >
          <Upload className="size-3 mr-1" />
          {t('settings.import')}
        </Button>
      </div>
      {/* A file carrying plaintext cannot be imported by pressing Import: the
          choice is a data outcome, not a confirmation. */}
      {secrets?.needsDecision && (
        <ImportSecretsPanel
          diagnosis={secrets}
          onMigrate={onMigrateSecrets}
          onDiscard={onDiscardSecrets}
          onCancel={onCancelSecrets}
          busy={false}
        />
      )}
    </div>
  )
}
