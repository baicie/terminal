import type { SSHKeyRecord } from '@/service/database'
import { getSSHKeySecret } from '@/service/database'
import { parseCredentialRef } from '@/service/credential-ref'
import { describeRefProblem } from '@/features/terminal/services/session-credentials'
import { Eye, EyeOff, Copy, Loader2 } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/sonner'

/**
 * On-demand access to a stored key's private half.
 *
 * The list read never returns a private key or a passphrase: they live in the
 * vault and the row carries only a reference. This component is the one place a
 * user can ask for the value, and it does so per action, per click:
 *
 *  - nothing is fetched on mount, so opening a key does not touch the vault;
 *  - the value is held in this component's state and nowhere else — not the store,
 *    not a log line, not a URL;
 *  - it disappears when the user hides it or selects another key.
 *
 * Without this, `getSSHKeySecret` had no caller at all: the secrets were written to
 * the vault correctly and then unreachable, which is a saved credential the user
 * cannot use.
 */
export function KeySecretActions({
  selectedKey,
}: {
  selectedKey: SSHKeyRecord | null
}) {
  const { t } = useTranslation()
  const [revealed, setRevealed] = useState<string | null>(null)
  const [busy, setBusy] = useState<'reveal' | 'copy' | null>(null)

  // Computed before the callbacks so the read can report a damaged reference
  // instead of the generic "unavailable" message.
  const parsedRef =
    selectedKey?.credential_ref === null || selectedKey?.credential_ref === undefined
      ? null
      : parseCredentialRef(selectedKey.credential_ref)
  const refProblem = parsedRef && !parsedRef.ok ? parsedRef.problem : null

  const readSecret = useCallback(async (): Promise<string | null> => {
    if (!selectedKey) return null
    const value = await getSSHKeySecret(selectedKey.id, 'privateKey')
    if (value === undefined) {
      toast.error(t('keychain.privateKeyUnavailable'), {
        description: refProblem
          ? describeRefProblem(refProblem)
          : t('keychain.privateKeyUnavailableDesc'),
      })
      return null
    }
    return value
  }, [selectedKey, t, refProblem])

  const handleReveal = useCallback(async () => {
    if (revealed !== null) {
      // Hiding never needs the vault.
      setRevealed(null)
      return
    }
    setBusy('reveal')
    try {
      const value = await readSecret()
      if (value !== null) setRevealed(value)
    } catch (error) {
      toast.error(t('keychain.privateKeyUnavailable'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }, [readSecret, revealed, t])

  const handleCopy = useCallback(async () => {
    setBusy('copy')
    try {
      // Copying reads its own value and immediately drops it: the clipboard is the
      // destination, not this component's state.
      const value = revealed ?? (await readSecret())
      if (value !== null) {
        await navigator.clipboard.writeText(value)
        toast.success(t('keychain.privateKeyCopied'))
      }
    } catch (error) {
      toast.error(t('keychain.privateKeyUnavailable'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }, [readSecret, revealed, t])

  // A new key has nothing stored yet, and a public-only key stores no private half.
  // A *damaged* reference is not the same as no reference: the button stays, and
  // the read reports the problem, because hiding it would make a stored key look
  // like an empty one.
  if (!selectedKey || selectedKey.credential_ref === null || selectedKey.credential_ref === undefined) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={handleReveal}
        disabled={busy !== null}
        aria-pressed={revealed !== null}
      >
        {busy === 'reveal' ? (
          <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
        ) : revealed !== null ? (
          <EyeOff className="size-4" data-icon="inline-start" />
        ) : (
          <Eye className="size-4" data-icon="inline-start" />
        )}
        {revealed !== null
          ? t('keychain.hidePrivateKey')
          : t('keychain.revealPrivateKey')}
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={handleCopy}
        disabled={busy !== null}
      >
        {busy === 'copy' ? (
          <Loader2 className="size-4 animate-spin" data-icon="inline-start" />
        ) : (
          <Copy className="size-4" data-icon="inline-start" />
        )}
        {t('keychain.copyPrivateKey')}
      </Button>
      {revealed !== null && (
        <p className="text-xs text-muted-foreground w-full">
          {t('keychain.privateKeyVisibleWarning')}
        </p>
      )}
    </div>
  )
}
