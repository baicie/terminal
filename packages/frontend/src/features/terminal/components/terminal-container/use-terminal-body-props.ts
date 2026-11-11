import type { Terminal as XTerminal } from '@baicie/xterm'
import type { SearchAddon } from '@xterm/addon-search'
import type { RefObject, TouchEvent } from 'react'
import type { Host, Tab } from '@/types'
import type { UseTerminalResult } from '@/hooks/terminal-session-types'

/**
 * Assemble the props `TerminalBody` needs.
 *
 * Thirty-odd expressions, all of them a direct read of something the container
 * already holds. Keeping them here rather than inline is what lets
 * `container.tsx` stay inside its size limit without deleting any of the wiring —
 * which is the failure mode a size limit invites.
 */
export function useTerminalBodyProps(args: {
  tab: Tab | null
  host?: Host
  session: UseTerminalResult & { disconnect: () => void; reconnectAction: () => void }
  errorSurface: { readableError: string | null; dismissed: boolean; dismiss: () => void }
  isMobile: boolean
  terminalIsActive: boolean
  containerRef: RefObject<HTMLDivElement | null>
  term: XTerminal | null
  searchAddon: SearchAddon | null
  themeBackground: string
  ui: {
    isFullscreen: boolean
    shellCwd?: string
    lastExitCode?: number
    searchOpen: boolean
    mobileMenuOpen: boolean
    toolSidebarOpen: boolean
    setSearchOpen: (open: boolean) => void
    setMobileMenuOpen: (open: boolean) => void
    setToolSidebarOpen: (open: boolean) => void
    setIsFullscreen: (open: boolean) => void
  }
  terminal: {
    fontSize: number
    changeFontSize: (delta: number) => void
    resetFontSize: () => void
  }
  write: (data: string) => void
  longPress: {
    start: (event: TouchEvent<HTMLDivElement>) => void
    cancel: () => void
    move: (event: TouchEvent<HTMLDivElement>) => void
  }
}) {
  const { host, session, errorSurface, isMobile, terminalIsActive, ui } = args
  return {
    // `tab` is non-null at every render that uses these props: the container
    // returns its empty state first. The type stays nullable so the hook can be
    // called unconditionally, which hook rules require.
    tab: args.tab as Tab,
    host,
    status: session.status,
    readableError: errorSurface.readableError,
    errorDismissed: errorSurface.dismissed,
    onDismissError: errorSurface.dismiss,
    reconnectAttempt: session.attempt,
    reconnectReason: session.reason,
    reconnectRetryable: session.retryable,
    credentialKind: session.credentialKind,
    isMobile,
    active: terminalIsActive,
    isFullscreen: ui.isFullscreen,
    terminalFontSize: args.terminal.fontSize,
    terminalBackground: args.themeBackground,
    shellCwd: ui.shellCwd,
    lastExitCode: ui.lastExitCode,
    term: args.term,
    containerRef: args.containerRef,
    searchAddon: args.searchAddon,
    searchOpen: ui.searchOpen,
    mobileMenuOpen: ui.mobileMenuOpen,
    onSearchOpenChange: ui.setSearchOpen,
    onMobileMenuOpenChange: ui.setMobileMenuOpen,
    onSendKey: args.write,
    onFontSizeChange: args.terminal.changeFontSize,
    onResetFontSize: args.terminal.resetFontSize,
    onClear: () => args.term?.clear(),
    toolSidebarOpen: ui.toolSidebarOpen,
    onToggleToolSidebar: () => ui.setToolSidebarOpen(!ui.toolSidebarOpen),
    onReconnect: session.reconnectAction,
    onDisconnect: session.disconnect,
    onToggleFullscreen: () => ui.setIsFullscreen(!ui.isFullscreen),
    onTouchStart: args.longPress.start,
    onTouchEnd: args.longPress.cancel,
    onTouchMove: args.longPress.move,
  }
}
