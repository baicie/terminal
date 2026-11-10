import { useTranslation } from 'react-i18next'

/**
 * Which vault action the current error points at, or null when it is not a
 * credential failure.
 *
 * Kept as a small pure function so the header stays readable and the mapping is
 * testable on its own.
 */
export function vaultActionFor(message: string | undefined): string | null {
  if (!message) return null
  const normalized = message.toLowerCase()
  if (normalized.includes('no vault has been set up')) {
    return 'terminal.vault.create'
  }
  if (
    normalized.includes('vault is locked') ||
    normalized.includes('which is locked') ||
    normalized.includes('could not be read')
  ) {
    return 'terminal.vault.unlock'
  }
  if (normalized.includes('this build cannot read')) {
    return 'terminal.vault.manage'
  }
  return null
}

/**
 * The link a credential failure puts in the pane header.
 *
 * A plain anchor rather than a router call: the terminal pane is rendered from
 * the always-mounted terminal layer, and navigating from there through the
 * router would unmount the session the user is looking at.
 */
export function TerminalVaultAction({
  action,
  title,
}: {
  action: string
  title?: string
}) {
  const { t } = useTranslation()
  return (
    <a
      href="#/vaults"
      data-testid="terminal-vault-action"
      className="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      title={title}
    >
      {t(action)}
    </a>
  )
}
