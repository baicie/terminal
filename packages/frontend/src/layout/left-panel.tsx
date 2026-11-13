import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react'
import type { Host } from '@/types'
import { ConnectionExplorer } from '@/features/connection-explorer/connection-explorer'
import AppSidebar from '@/components/app-sidebar'
import { SIDEBAR_MAX, SIDEBAR_MIN } from './sidebar-width'
import { cn } from '@/lib/utils'

/**
 * The left column: either the Connection Explorer or the full navigation sidebar.
 *
 * **One panel at a time.** UX-1a shipped the activity rail beside a sidebar that
 * could also be open, and the result was two navigation columns listing the same
 * destinations with a 220px narrower terminal — the exact regression this phase
 * exists to remove. The rail now switches *which* panel is open instead of sitting
 * next to it.
 *
 * There are three real presentations, not two:
 *
 * - `column` — the panel takes its width out of the row and the terminal yields.
 * - `drawer` — the panel floats *over* the terminal, taking no column width, so
 *   the terminal keeps its full width while the panel is reachable. This is what
 *   the layout decision asks for when a column would starve the terminal.
 * - `none` — nothing is shown.
 *
 * The drawer is the case that must not be faked: earlier the decision could return
 * `drawer` and this component simply rendered nothing, so the panel was
 * unreachable exactly when the user needed it most.
 *
 * The resize separator and the width both come from the caller, which already owns
 * `terminal.sidebar.width`. Nothing here stores a width.
 */
export type LeftPanelMode = 'explorer' | 'navigation' | 'none'
export type LeftPanelPresentation = 'none' | 'column' | 'drawer'

export interface LeftPanelProps {
  mode: LeftPanelMode
  /** How the mode is presented. `drawer` floats over the terminal. */
  presentation: LeftPanelPresentation
  width: number
  resizing: boolean
  resizeLabel: string
  drawerLabel: string
  onToggleCollapse: () => void
  onDismissDrawer: () => void
  onResizeStart: (event: PointerEvent) => void
  onResizeKeyDown: (event: KeyboardEvent) => void
  onConnect: (host: Host) => void
  onEdit: (host: Host) => void
  onNewHost: () => void
  activeHostId: string | null
}

export function LeftPanel(props: LeftPanelProps) {
  const drawer = props.presentation === 'drawer' && props.mode !== 'none'
  const drawerRef = useRef<HTMLDivElement | null>(null)

  // Escape closes the drawer, and focus moves into it when it opens so a keyboard
  // user is not left tabbing through the terminal behind it. The terminal element
  // itself is untouched — this is a presentation change, not a remount.
  useEffect(() => {
    if (!drawer) return
    const element = drawerRef.current
    element?.focus()
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        props.onDismissDrawer()
      }
    }
    element?.addEventListener('keydown', onKeyDown)
    return () => element?.removeEventListener('keydown', onKeyDown)
  }, [drawer, props])

  if (props.presentation === 'none' || props.mode === 'none') return null

  const panel =
    props.mode === 'explorer' ? (
      <ConnectionExplorer
        width={props.width}
        resizing={props.resizing}
        onConnect={props.onConnect}
        onEdit={props.onEdit}
        onNewHost={props.onNewHost}
        activeHostId={props.activeHostId}
      />
    ) : (
      <AppSidebar
        onToggleCollapse={props.onToggleCollapse}
        width={props.width}
        resizing={props.resizing}
      />
    )

  if (drawer) {
    // No separator: a drawer has no width to drag, and a resize handle over the
    // terminal would be a control that changes nothing.
    return (
      <>
        <button
          type="button"
          aria-label={props.drawerLabel}
          data-testid="left-drawer-scrim"
          onClick={props.onDismissDrawer}
          className="absolute inset-0 z-30 bg-background/40"
        />
        <div
          ref={drawerRef}
          role="dialog"
          aria-modal="true"
          aria-label={props.drawerLabel}
          tabIndex={-1}
          data-testid="left-drawer"
          data-presentation="drawer"
          className="absolute inset-y-0 left-0 z-40 flex outline-none shadow-xl"
          style={{ width: props.width }}
        >
          {panel}
          <button
            type="button"
            onClick={props.onDismissDrawer}
            aria-label={props.drawerLabel}
            data-testid="left-drawer-close"
            className="absolute right-1 top-1 z-10 rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
      </>
    )
  }

  return (
    <div data-testid="left-column" data-presentation="column" className="flex shrink-0">
      {panel}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        aria-valuenow={props.width}
        aria-label={props.resizeLabel}
        tabIndex={0}
        className={cn(
          'w-[6px] shrink-0 cursor-col-resize flex items-center justify-center group outline-none select-none',
          'hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
          props.resizing && 'cursor-col-resize bg-primary/20',
        )}
        onPointerDown={props.onResizeStart}
        onKeyDown={props.onResizeKeyDown}
      >
        <div className="flex flex-col gap-1.5 py-8 opacity-0 group-hover:opacity-100 transition-opacity">
          <span className="size-1 rounded-full bg-muted-foreground/60" />
          <span className="size-1 rounded-full bg-muted-foreground/60" />
          <span className="size-1 rounded-full bg-muted-foreground/60" />
        </div>
      </div>
    </div>
  )
}
