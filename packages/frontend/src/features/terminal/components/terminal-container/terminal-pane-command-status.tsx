import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface TerminalPaneCommandStatusProps {
  lastExitCode?: number
}

/**
 * Exit status of the last command the shell reported through OSC 133 `D`.
 * A non-zero status is the one signal that tells the user a command failed
 * without scrolling back through the scrollback to find it. It only renders
 * when a shell actually reported a status: an absent signal is not a zero exit
 * code, so nothing is shown rather than a reassuring green marker.
 */
export function TerminalPaneCommandStatus({
  lastExitCode,
}: TerminalPaneCommandStatusProps) {
  const { t } = useTranslation()
  if (lastExitCode === undefined) return null
  const label =
    lastExitCode === 0
      ? t('terminal.lastCommandSucceeded')
      : t('terminal.lastCommandFailed', { code: lastExitCode })
  return (
    <span
      className={cn(
        'hidden shrink-0 font-medium @lg:inline',
        lastExitCode === 0 ? 'text-success' : 'text-destructive',
      )}
      data-last-exit-code={lastExitCode}
    >
      {' '}
      · {label}
    </span>
  )
}
