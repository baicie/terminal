import { AlertTriangle, KeyRound, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import type { ImportSecretsDiagnosis } from '@/service/sync-import'

/**
 * The decision an import file's plaintext credentials require.
 *
 * Three buttons, each one a different *data outcome*, which is why this is not a
 * checkbox:
 *
 *  - migrate: the values end up in this device's vault and the rows point at them;
 *  - discard: the rows import without credentials and the user is told which ones
 *    must be set again;
 *  - cancel: nothing is imported.
 *
 * The file's own reference (what the source device had) is shown separately: even
 * after `migrate` decides the plaintext, a host whose secret was *not* in the file
 * still needs the user's attention. Conflating the two would let an import finish
 * "successfully" with hosts that cannot connect and no explanation.
 */
export function ImportSecretsPanel({
  diagnosis,
  onMigrate,
  onDiscard,
  onCancel,
  busy,
}: {
  diagnosis: ImportSecretsDiagnosis
  onMigrate: () => void
  onDiscard: () => void
  onCancel: () => void
  busy: boolean
}) {
  const { t } = useTranslation()
  const { counts } = diagnosis
  return (
    <div className="space-y-3 p-3 rounded-lg border border-destructive/40 bg-destructive/5">
      <div className="flex items-start gap-2">
        <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="text-sm font-medium">{t('settings.importSecretsTitle')}</p>
          <p className="text-xs text-muted-foreground">
            {t('settings.importSecretsDesc')}
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground" data-testid="secret-counts">
        {t('settings.importSecretsCounts', {
          hostPasswords: counts.hostPasswords,
          hostPrivateKeys: counts.hostPrivateKeys,
          sshKeyPrivateKeys: counts.sshKeyPrivateKeys,
          sshKeyPassphrases: counts.sshKeyPassphrases,
        })}
      </p>

      {diagnosis.rows.length > 0 && (
        <ul className="max-h-40 overflow-y-auto space-y-1 text-xs">
          {diagnosis.rows.map(row => (
            <li
              key={`${row.resource}:${row.id}`}
              className="flex items-center gap-1 text-muted-foreground"
            >
              <KeyRound className="size-3 shrink-0" />
              <span className="truncate">{row.name || row.id}</span>
              <span className="opacity-70">({row.kinds.join(', ')})</span>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2">
        <Button
          size="sm"
          className="w-full justify-start"
          onClick={onMigrate}
          disabled={busy}
        >
          <ShieldCheck className="size-3 mr-1" data-icon="inline-start" />
          {t('settings.importSecretsMigrate')}
        </Button>
        <p className="text-xs text-muted-foreground pl-1">
          {t('settings.importSecretsMigrateDesc')}
        </p>

        <Button
          size="sm"
          variant="outline"
          className="w-full justify-start"
          onClick={onDiscard}
          disabled={busy}
        >
          {t('settings.importSecretsDiscard')}
        </Button>
        <p className="text-xs text-muted-foreground pl-1">
          {t('settings.importSecretsDiscardDesc')}
        </p>

        <Button
          size="sm"
          variant="ghost"
          className="w-full"
          onClick={onCancel}
          disabled={busy}
        >
          {t('settings.importSecretsCancel')}
        </Button>
      </div>
    </div>
  )
}

/** After an import: which rows still need the user to set a credential. */
export function NeedsRebindPanel({
  rows,
}: {
  rows: ImportSecretsDiagnosis['sourceCredentialRefs']
}) {
  const { t } = useTranslation()
  if (rows.length === 0) return null
  return (
    <div
      className="p-3 rounded-lg bg-muted space-y-2"
      data-testid="needs-rebind"
    >
      <p className="text-sm font-medium">
        {t('settings.importNeedsRebind', { count: rows.length })}
      </p>
      <p className="text-xs text-muted-foreground">
        {t('settings.importNeedsRebindDesc')}
      </p>
      <ul className="max-h-32 overflow-y-auto space-y-1 text-xs">
        {rows.map(row => (
          <li key={`${row.resource}:${row.id}`} className="truncate">
            {row.name || row.id}
            {row.kinds.length > 0 && (
              <span className="text-muted-foreground"> ({row.kinds.join(', ')})</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
