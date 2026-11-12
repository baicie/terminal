import type { KeyboardEvent, PointerEvent } from 'react'
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
 * next to it:
 *
 * - `explorer` → the connection list (the terminal-first default)
 * - `navigation` → the full sidebar, for the surfaces the rail does not carry
 *   (teams, logs, known hosts, vaults, settings)
 * - `none` → neither, and the terminal takes the full width
 *
 * The resize separator and the width both come from the caller, which already owns
 * `terminal.sidebar.width`. Nothing here stores a width.
 */
export type LeftPanelMode = 'explorer' | 'navigation' | 'none'

export interface LeftPanelProps {
  mode: LeftPanelMode
  width: number
  resizing: boolean
  resizeLabel: string
  onToggleCollapse: () => void
  onResizeStart: (event: PointerEvent) => void
  onResizeKeyDown: (event: KeyboardEvent) => void
  onConnect: (host: Host) => void
  onEdit: (host: Host) => void
  onNewHost: () => void
  activeHostId: string | null
}

export function LeftPanel(props: LeftPanelProps) {
  if (props.mode === 'none') return null
  return (
    <>
      {props.mode === 'explorer' ? (
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
      )}
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
    </>
  )
}
