import { Download, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { ImportSecretsPanel } from '@/components/settings-dialog/import-secrets-panel'
import type { ImportSecretsDiagnosis } from '@/service/sync'

export interface TeamPackagePreview {
  teamName: string
  hosts: number
  groups: number
  snippets: number
  members: number
}

/**
 * The team package preview, including the decision a package's plaintext
 * credentials require.
 *
 * Its own component so the Import button and that decision stay in one place: a
 * package from an older build can carry passwords, and pressing Import must not be
 * a way past the question.
 */
export function TeamPackagePreviewCard({
  preview,
  error,
  secrets,
  busy,
  onCancel,
  onImport,
  onMigrateSecrets,
  onDiscardSecrets,
}: {
  preview: TeamPackagePreview
  error: string | null
  secrets: ImportSecretsDiagnosis | null
  busy: boolean
  onCancel: () => void
  onImport: () => void
  onMigrateSecrets: () => void
  onDiscardSecrets: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4 py-4">
      <div className="p-4 bg-muted rounded-lg space-y-2">
        <div className="font-medium flex items-center gap-2">
          <Package className="size-4" />
          {preview.teamName}
        </div>
        <div className="text-sm text-muted-foreground space-y-1">
          {preview.hosts > 0 && (
            <div>•{t('teams.packageHosts', { count: preview.hosts })}</div>
          )}
          {preview.groups > 0 && (
            <div>•{t('teams.packageGroups', { count: preview.groups })}</div>
          )}
          {preview.snippets > 0 && (
            <div>•{t('teams.packageSnippets', { count: preview.snippets })}</div>
          )}
          {preview.members > 0 && (
            <div>•{t('teams.packageMembers', { count: preview.members })}</div>
          )}
        </div>
      </div>
      {error && (
        <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
          {error}
        </div>
      )}
      {secrets?.needsDecision && (
        <ImportSecretsPanel
          diagnosis={secrets}
          onMigrate={onMigrateSecrets}
          onDiscard={onDiscardSecrets}
          onCancel={onCancel}
          busy={busy}
        />
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button onClick={onImport} disabled={Boolean(secrets?.needsDecision)}>
          <Download className="size-4 mr-2" />
          {t('teams.import')}
        </Button>
      </DialogFooter>
    </div>
  )
}
