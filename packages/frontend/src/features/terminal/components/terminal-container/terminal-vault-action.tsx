import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { cn } from '@/lib/utils'
import type { CredentialFailureKind } from '../../services/credential-failure'

/**
 * Which action a credential failure points at.
 *
 * Decided from the structured kind, never from the message. Matching sentences
 * is how a vault that "could not be read" ended up offering "Unlock the vault":
 * the fix for an unreadable vault is to go and look at it, not to unlock it, and
 * the sentence does not reliably carry the difference.
 *
 * Three of the kinds need the host's credential re-saved rather than the vault
 * touched, so they point at the hosts view; sending the user to the Vaults page
 * would leave them with nothing to do there.
 */
export type VaultActionLabel =
  | 'terminal.vault.create'
  | 'terminal.vault.unlock'
  | 'terminal.vault.manage'
  | 'terminal.vault.rebind'

export interface VaultAction {
  label: VaultActionLabel
  href: '/vaults' | '/hosts'
}

const ACTION_BY_KIND: Record<CredentialFailureKind, VaultAction> = {
  'vault-locked': { label: 'terminal.vault.unlock', href: '/vaults' },
  'vault-uninitialized': { label: 'terminal.vault.create', href: '/vaults' },
  'vault-unusable': { label: 'terminal.vault.manage', href: '/vaults' },
  // A decrypt that failed while the vault is unlocked is a vault problem, not a
  // network one: the user has to look at the vault, so it points there rather
  // than at "unlock", which would be advice that does not apply.
  'credential-read-failed': { label: 'terminal.vault.manage', href: '/vaults' },
  'credential-corrupt-reference': {
    label: 'terminal.vault.rebind',
    href: '/hosts',
  },
  'credential-not-bound': { label: 'terminal.vault.rebind', href: '/hosts' },
  'credential-missing': { label: 'terminal.vault.rebind', href: '/hosts' },
}

/**
 * The action for a credential failure, or null when the failure is not one.
 *
 * `status` matters as much as the kind: a stale kind left on a session that has
 * since connected or started reconnecting would otherwise offer "Unlock the
 * vault" on a working connection.
 */
export function vaultActionFor(
  credentialKind: string | undefined,
  status: string,
): VaultAction | null {
  if (status !== 'error') return null
  if (credentialKind === undefined) return null
  if (!Object.hasOwn(ACTION_BY_KIND, credentialKind)) return null
  return ACTION_BY_KIND[credentialKind as CredentialFailureKind]
}

/**
 * The action a credential failure puts in the pane header.
 *
 * Rendered as an anchor with an `href` so it is a link to assistive technology
 * and can be opened in a new window, but the ordinary click is handled by the
 * router. The app builds its router with `createBrowserRouter`, so a bare
 * `<a href>` would perform a real document navigation — reloading the webview
 * and tearing down every live session, including the one this header belongs to.
 * The earlier `#/vaults` variant avoided the reload but did nothing at all: with
 * a history-API router a fragment change matches no route.
 */
export function TerminalVaultAction({
  action,
  title,
}: {
  action: VaultAction
  title?: string
}) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  return (
    <a
      href={action.href}
      data-testid="terminal-vault-action"
      className={cn(
        'shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-primary',
        'underline-offset-2 hover:underline',
        'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
      )}
      title={title}
      onClick={event => {
        // Leave modified clicks alone: they legitimately mean "new window".
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return
        }
        event.preventDefault()
        navigate(action.href)
      }}
    >
      {t(action.label)}
    </a>
  )
}
