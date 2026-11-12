import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { useRightPanelStore } from '@/store/right-panel-store'

/**
 * The right column.
 *
 * Same single-occupant rule as the left column (`UX-1b`): a value decides what is
 * there, not a boolean per panel. UX-1c ships one occupant, SFTP; `snippets` and
 * `ai` are named in `RightPanelMode` so adding them is a case, not a second flag
 * that nobody cross-checks.
 *
 * **The dock does not own a PTY.** It is a sibling of `TerminalByUrl`, so opening
 * or closing it never creates, moves or disposes a session. And because the SFTP
 * panel's own session now survives unmount while transfers are running
 * (`INV-14`), closing the dock does not truncate an upload either.
 *
 * Lazy, because SFTP is not on the time-to-first-terminal path: a user who never
 * opens it should not download its code.
 */
const SftpContainer = lazy(() =>
  import('@/view/sftp/sftp-container').then(module => ({
    default: module.default,
  })),
)

export const DOCK_WIDTH = 420

export function RightPanel() {
  const { t } = useTranslation()
  const rightPanel = useRightPanelStore(state => state.rightPanel)
  if (rightPanel === 'none') return null
  return (
    <aside
      style={{ width: DOCK_WIDTH }}
      className="h-full shrink-0 overflow-hidden border-l border-border/60 bg-background"
      aria-label={t('sftp.dockTitle')}
      data-testid="right-panel"
      data-panel={rightPanel}
    >
      <Suspense
        fallback={
          <div
            className="h-full w-full bg-background"
            aria-hidden="true"
            data-testid="right-panel-loading"
          />
        }
      >
        <SftpContainer />
      </Suspense>
    </aside>
  )
}
