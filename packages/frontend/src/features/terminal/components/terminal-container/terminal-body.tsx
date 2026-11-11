import type { Terminal as XTerminal } from '@baicie/xterm'
import type { SearchAddon } from '@xterm/addon-search'
import {
  useCallback,
  useRef,
  type RefObject,
  type TouchEventHandler,
} from 'react'
import { createPortal } from 'react-dom'
import type { Host, Tab } from '@/types'
import type { UseTerminalResult } from '@/hooks/terminal-session-types'
import { TerminalKeyboardBar } from './keyboard-bar'
import { TerminalPaneHeader } from './terminal-pane-header'
import { TerminalSurface } from './terminal-surface'
import TerminalToolSidebar from '@/components/terminal-tool-sidebar'

interface TerminalBodyProps {
  tab: Tab
  host?: Host
  status: UseTerminalResult['status']
  readableError: string | null
  reconnectAttempt?: number
  reconnectReason?: string
  reconnectRetryable?: boolean
  credentialKind?: string
  /** Cleared by the pane when the user dismisses the failure overlay. */
  errorDismissed: boolean
  onDismissError: () => void
  isMobile: boolean
  active: boolean
  isFullscreen: boolean
  terminalFontSize: number
  terminalBackground: string
  shellCwd?: string
  lastExitCode?: number
  term: XTerminal | null
  containerRef: RefObject<HTMLDivElement | null>
  searchAddon: SearchAddon | null
  searchOpen: boolean
  mobileMenuOpen: boolean
  onSearchOpenChange: (open: boolean) => void
  onMobileMenuOpenChange: (open: boolean) => void
  onSendKey: (data: string) => void
  onFontSizeChange: (delta: number) => void
  onResetFontSize: () => void
  onClear: () => void
  toolSidebarOpen: boolean
  onToggleToolSidebar: () => void
  onToggleFullscreen: () => void
  onReconnect?: () => void
  onDisconnect?: () => void
  onTouchStart: TouchEventHandler<HTMLDivElement>
  onTouchEnd: TouchEventHandler<HTMLDivElement>
  onTouchMove: TouchEventHandler<HTMLDivElement>
}

export function TerminalBody(props: TerminalBodyProps) {
  const activeRef = useRef(props.active)
  activeRef.current = props.active
  const requestTerminalFocus = () => {
    if (activeRef.current) props.term?.focus()
  }
  const closeSearch = () => {
    props.onSearchOpenChange(false)
    requestTerminalFocus()
  }
  const toggleToolSidebar = () => {
    props.onToggleToolSidebar()
    requestAnimationFrame(requestTerminalFocus)
  }
  const setMobileMenuOpen = (open: boolean) => {
    props.onMobileMenuOpenChange(open)
    if (!open) requestAnimationFrame(requestTerminalFocus)
  }
  const setContainerRef = useCallback(
    (node: HTMLDivElement | null) => {
      props.containerRef.current = node
      const terminalElement = props.term?.element
      if (node && terminalElement && terminalElement.parentElement !== node) {
        node.appendChild(terminalElement)
      }
    },
    [props.containerRef, props.term],
  )
  const body = (
    <div
      className="flex h-full bg-background"
      style={{ backgroundColor: props.terminalBackground }}
    >
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TerminalPaneHeader
          tab={props.tab}
          host={props.host}
          status={props.status}
          errorMessage={props.readableError ?? undefined}
          shellCwd={props.shellCwd}
          lastExitCode={props.lastExitCode}
          reconnectAttempt={props.reconnectAttempt}
          reconnectReason={props.reconnectReason}
          reconnectRetryable={props.reconnectRetryable}
          credentialKind={props.credentialKind}
          fontSize={props.terminalFontSize}
          isMobile={props.isMobile}
          toolsOpen={props.toolSidebarOpen}
          fullscreen={props.isFullscreen}
          onSearch={() => props.onSearchOpenChange(true)}
          onClear={props.onClear}
          onToggleTools={props.onToggleToolSidebar}
          onFontSizeChange={props.onFontSizeChange}
          onResetFontSize={props.onResetFontSize}
          onToggleFullscreen={props.onToggleFullscreen}
          onRequestFocus={requestTerminalFocus}
          onReconnect={props.onReconnect}
          onDisconnect={props.onDisconnect}
        />
        <TerminalSurface
          tab={props.tab}
          host={props.host}
          status={props.status}
          readableError={props.readableError}
          credentialKind={props.credentialKind}
          errorDismissed={props.errorDismissed}
          isMobile={props.isMobile}
          term={props.term}
          containerRef={props.containerRef}
          setContainerRef={setContainerRef}
          searchAddon={props.searchAddon}
          searchOpen={props.searchOpen}
          mobileMenuOpen={props.mobileMenuOpen}
          onSearchOpenChange={props.onSearchOpenChange}
          onSearchClose={closeSearch}
          onMobileMenuOpenChange={setMobileMenuOpen}
          onFontSizeChange={props.onFontSizeChange}
          onReconnect={props.onReconnect}
          onDismissError={props.onDismissError}
          onTouchStart={props.onTouchStart}
          onTouchEnd={props.onTouchEnd}
          onTouchMove={props.onTouchMove}
        />
        {props.isMobile && (
          <TerminalKeyboardBar
            onSendKey={props.onSendKey}
            onFontSizeChange={props.onFontSizeChange}
            fontSize={props.terminalFontSize}
            isFullscreen={props.isFullscreen}
            onToggleFullscreen={props.onToggleFullscreen}
            onRequestFocus={requestTerminalFocus}
          />
        )}
      </div>
      {!props.isMobile && (
        <TerminalToolSidebar
          visible={props.toolSidebarOpen}
          onToggle={toggleToolSidebar}
        />
      )}
    </div>
  )

  if (props.isFullscreen && props.active) {
    return createPortal(
      <div
        className="fixed inset-0 z-[150] bg-background"
        data-terminal-fullscreen
      >
        {body}
      </div>,
      document.body,
    )
  }
  return body
}
