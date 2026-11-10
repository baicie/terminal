/**
 * The notice a host shows when it was imported from an OpenSSH config that named
 * an `IdentityFile`.
 *
 * Such a host cannot connect: the app will not read arbitrary files during a
 * connection attempt, and the row holds no credential of its own. Without this
 * panel the host looked configured (it has a hostname, a user, an auth type) and
 * failed with a message about a path the user never chose in this app.
 *
 * What it says, in order: which file the config named, why the app will not read
 * it on its own, and the one action that resolves it — paste the key, which the
 * existing form already knows how to store in the vault.
 */

import { FileKey, ShieldAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

interface IdentityFileNoticeProps {
  path: string
  /** Bring the key field into view so the fix is one action, not a hunt. */
  onFocusKeyField: () => void
}

export function IdentityFileNotice({
  path,
  onFocusKeyField,
}: IdentityFileNoticeProps) {
  const { t } = useTranslation()

  return (
    <div
      data-testid="identity-file-notice"
      className="flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/5 p-3"
    >
      <FileKey className="size-5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium">
          {t('hosts.identityFile.title')}
        </p>
        <p className="font-mono text-xs break-all text-muted-foreground">
          {path}
        </p>
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
          {t('hosts.identityFile.explain')}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={onFocusKeyField}
          data-testid="identity-file-bind-key"
        >
          {t('hosts.identityFile.bindAction')}
        </Button>
      </div>
    </div>
  )
}
