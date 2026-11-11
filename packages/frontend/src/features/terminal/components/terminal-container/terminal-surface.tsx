import type { Terminal as XTerminal } from '@baicie/xterm'
import type { SearchAddon } from '@xterm/addon-search'
import type { RefObject, TouchEventHandler } from 'react'
import type { Host, Tab } from '@/types'
import { TerminalContextMenu } from './terminal-context-menu'
import { TerminalErrorOverlay } from './terminal-error-overlay'
import { TerminalMobileMenu } from './terminal-mobile-menu'
import { TerminalSearchOverlay } from './terminal-search-overlay'

interface TerminalSurfaceProps {
  tab: Tab
  host?: Host
  status: string
  readableError: string | null
  credentialKind?: string
  errorDismissed: boolean
  isMobile: boolean
  term: XTerminal | null
  containerRef: RefObject<HTMLDivElement | null>
  setContainerRef: (node: HTMLDivElement | null) => void
  searchAddon: SearchAddon | null
  searchOpen: boolean
  mobileMenuOpen: boolean
  onSearchOpenChange: (open: boolean) => void
  /** Closes search and returns focus to the terminal, as the pane expects. */
  onSearchClose: () => void
  onMobileMenuOpenChange: (open: boolean) => void
  onFontSizeChange: (delta: number) => void
  onReconnect?: () => void
  onDismissError: () => void
  onTouchStart: TouchEventHandler<HTMLDivElement>
  onTouchEnd: TouchEventHandler<HTMLDivElement>
  onTouchMove: TouchEventHandler<HTMLDivElement>
}

/**
 * The xterm host area and everything layered over it.
 *
 * Split out of `TerminalBody` because that file is at its size limit and because
 * the mounting of the xterm element (whichever gesture surface wraps it) is a
 * different concern from the keyboard bar and tool sidebar around it.
 */
export function TerminalSurface(props: TerminalSurfaceProps) {
  const openSearch = () => props.onSearchOpenChange(true)
  const terminalHost = (
    <div
      ref={props.setContainerRef}
      className={
        props.isMobile
          ? 'absolute inset-0 overflow-hidden'
          : 'absolute inset-0 overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40'
      }
      tabIndex={0}
      role="application"
      aria-label="Terminal"
      style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
      onTouchStart={props.isMobile ? props.onTouchStart : undefined}
      onTouchEnd={props.isMobile ? props.onTouchEnd : undefined}
      onTouchCancel={props.isMobile ? props.onTouchEnd : undefined}
      onTouchMove={props.isMobile ? props.onTouchMove : undefined}
    />
  )

  return (
    <div className="relative flex-1 min-h-0">
      {props.isMobile ? (
        terminalHost
      ) : (
        <TerminalContextMenu
          term={props.term}
          onFontSizeChange={props.onFontSizeChange}
          onOpenSearch={openSearch}
        >
          {terminalHost}
        </TerminalContextMenu>
      )}
      {props.readableError && !props.errorDismissed ? (
        <TerminalErrorOverlay
          tab={props.tab}
          host={props.host}
          status={props.status}
          errorMessage={props.readableError}
          credentialKind={props.credentialKind}
          onRetry={props.onReconnect}
          onDismiss={props.onDismissError}
        />
      ) : null}
      <TerminalSearchOverlay
        open={props.searchOpen}
        onClose={props.onSearchClose}
        searchAddon={props.searchAddon}
      />
      {props.isMobile ? (
        <TerminalMobileMenu
          term={props.term}
          onFontSizeChange={props.onFontSizeChange}
          onOpenSearch={openSearch}
          open={props.mobileMenuOpen}
          onOpenChange={props.onMobileMenuOpenChange}
        />
      ) : null}
    </div>
  )
}
