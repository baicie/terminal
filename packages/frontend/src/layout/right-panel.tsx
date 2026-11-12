import { lazy, Suspense } from 'react'
import { cn } from '@/lib/utils'
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

/**
 * The dock's width, from the design package's layout spec.
 *
 * It was 420 when UX-1c shipped. That is not a preference: at 1440px the terminal
 * got 114 columns with the dock open, below the package's own floor of 120. The
 * spec says 300, and 300 is what keeps the floor at the widths the spec names.
 */
export const DOCK_WIDTH = 300

/**
 * How the dock is presented.
 *
 * `column` takes width from the canvas; `overlay` floats over it. The switch is
 * decided by `usePanelLayout` from the *measured* cell width, so a zoomed font
 * moves the threshold instead of silently starving the terminal.
 *
 * An overlay is a presentation change, not a second component: same session, same
 * transfers, same close semantics. What changes is only where its pixels come from
 * — and a close button, so the user is never trapped behind a panel.
 */
export function RightPanel({ mode = 'column' }: { mode?: 'column' | 'overlay' }) {
  const { t } = useTranslation()
  const rightPanel = useRightPanelStore(state => state.rightPanel)
  const setRightPanel = useRightPanelStore(state => state.setRightPanel)
  if (rightPanel === 'none') return null
  const overlay = mode === 'overlay'
  return (
    <aside
      style={overlay ? { width: DOCK_WIDTH } : { width: DOCK_WIDTH }}
      className={cn(
        overlay
          ? 'absolute inset-y-0 right-0 z-20 overflow-hidden border-l border-border/60 bg-background shadow-xl'
          : 'h-full shrink-0 overflow-hidden border-l border-border/60 bg-background',
      )}
      aria-label={t('sftp.dockTitle')}
      data-testid="right-panel"
      data-panel={rightPanel}
      data-presentation={mode}
    >
      {overlay ? (
        <button
          type="button"
          onClick={() => setRightPanel('none')}
          aria-label={t('sftp.closeDock')}
          data-testid="right-panel-close"
          className="absolute right-1 top-1 z-10 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <CloseGlyph />
        </button>
      ) : null}
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

/** Kept local so the dock does not pull the icon set into its chunk. */
function CloseGlyph() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="size-3.5"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}
