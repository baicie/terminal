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
import { TerminalCompletionOverlay } from '@/components/terminal-completion/terminal-completion-overlay'
import { TerminalContextMenu } from './terminal-context-menu'
import { TerminalKeyboardBar } from './keyboard-bar'
import { TerminalMobileMenu } from './terminal-mobile-menu'
import { TerminalPaneHeader } from './terminal-pane-header'
import { TerminalSearchOverlay } from './terminal-search-overlay'
import TerminalToolSidebar from '@/components/terminal-tool-sidebar'
import type { TerminalCompletionController } from './use-terminal-completion'

interface TerminalBodyProps {
  tab: Tab
  host?: Host
  status: UseTerminalResult['status']
  readableError: string | null
  isMobile: boolean
  active: boolean
  isFullscreen: boolean
  terminalFontSize: number
  terminalBackground: string
  term: XTerminal | null
  containerRef: RefObject<HTMLDivElement | null>
  searchAddon: SearchAddon | null
  searchOpen: boolean
  mobileMenuOpen: boolean
  completion: TerminalCompletionController
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
      if (
        node &&
        terminalElement &&
        terminalElement.parentElement !== node
      ) {
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
        <div className="relative flex-1 min-h-0">
          {props.isMobile ? (
            <div
              ref={setContainerRef}
              className="absolute inset-0 overflow-hidden"
              tabIndex={0}
              role="application"
              aria-label="Terminal"
              style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
              onTouchStart={props.onTouchStart}
              onTouchEnd={props.onTouchEnd}
              onTouchCancel={props.onTouchEnd}
              onTouchMove={props.onTouchMove}
            />
          ) : (
            <TerminalContextMenu
              term={props.term}
              onFontSizeChange={props.onFontSizeChange}
              onOpenSearch={() => props.onSearchOpenChange(true)}
            >
              <div
                ref={setContainerRef}
                className="absolute inset-0 overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
                tabIndex={0}
                role="application"
                aria-label="Terminal"
                style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
              />
            </TerminalContextMenu>
          )}
          <TerminalSearchOverlay
            open={props.searchOpen}
            onClose={closeSearch}
            searchAddon={props.searchAddon}
          />
          {props.completion.open && (
            <TerminalCompletionOverlay
              items={props.completion.items}
              currentIndex={props.completion.index}
              position={props.completion.position}
              onSelect={(item, index) => {
                props.completion.setIndex(index)
                props.completion.select(item)
              }}
              onDismiss={props.completion.dismiss}
            />
          )}
          {props.isMobile && (
            <TerminalMobileMenu
              term={props.term}
              onFontSizeChange={props.onFontSizeChange}
              onOpenSearch={() => props.onSearchOpenChange(true)}
              open={props.mobileMenuOpen}
              onOpenChange={setMobileMenuOpen}
            />
          )}
        </div>
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
