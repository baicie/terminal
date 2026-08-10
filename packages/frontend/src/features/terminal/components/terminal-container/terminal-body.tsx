import type { Terminal as XTerminal } from '@baicie/xterm'
import type { SearchAddon } from '@xterm/addon-search'
import type { RefObject, TouchEventHandler } from 'react'
import type { Host, Tab } from '@/types'
import type { UseTerminalResult } from '@/hooks/terminal-session-types'
import { TerminalCompletionOverlay } from '@/components/terminal-completion/terminal-completion-overlay'
import { TerminalContextMenu } from './terminal-context-menu'
import { TerminalKeyboardBar } from './keyboard-bar'
import { TerminalMobileMenu } from './terminal-mobile-menu'
import { TerminalSearchOverlay } from './terminal-search-overlay'
import { SessionStatusBar } from './session-status-bar'
import type { TerminalCompletionController } from './use-terminal-completion'

interface TerminalBodyProps {
  tab: Tab
  host?: Host
  status: UseTerminalResult['status']
  readableError: string | null
  isMobile: boolean
  isFullscreen: boolean
  terminalFontSize: number
  term: XTerminal | null
  containerRef: RefObject<HTMLDivElement | null>
  searchAddon: SearchAddon | null
  searchOpen: boolean
  mobileMenuOpen: boolean
  completion: TerminalCompletionController
  onSearchOpenChange: (open: boolean) => void
  onMobileMenuOpenChange: (open: boolean) => void
  onFontSizeChange: (delta: number) => void
  onToggleFullscreen: () => void
  onTouchStart: TouchEventHandler<HTMLDivElement>
  onTouchEnd: TouchEventHandler<HTMLDivElement>
  onTouchMove: TouchEventHandler<HTMLDivElement>
}

export function TerminalBody(props: TerminalBodyProps) {
  const showStatusBar = !props.isMobile && !props.isFullscreen
  const body = (
    <div className="h-full flex bg-[#1e1e1e]">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {showStatusBar && (
          <SessionStatusBar
            tab={props.tab}
            host={props.host}
            status={props.status}
            errorMessage={props.readableError ?? undefined}
          />
        )}
        <div className="relative flex-1 min-h-0">
          {props.isMobile ? (
            <div
              ref={props.containerRef}
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
                ref={props.containerRef}
                className="absolute inset-0 overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
                tabIndex={0}
                role="application"
                aria-label="Terminal"
                style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
              />
            </TerminalContextMenu>
          )}
          {!props.isMobile && (
            <TerminalSearchOverlay
              open={props.searchOpen}
              onClose={() => {
                props.onSearchOpenChange(false)
                props.term?.focus()
              }}
              searchAddon={props.searchAddon}
            />
          )}
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
              open={props.mobileMenuOpen}
              onOpenChange={props.onMobileMenuOpenChange}
            />
          )}
        </div>
        {props.isMobile && (
          <TerminalKeyboardBar
            onSendKey={key => props.term?.write(key)}
            onFontSizeChange={props.onFontSizeChange}
            fontSize={props.terminalFontSize}
            isFullscreen={props.isFullscreen}
            onToggleFullscreen={props.onToggleFullscreen}
          />
        )}
      </div>
    </div>
  )

  if (props.isMobile && props.isFullscreen) {
    return <div className="fixed inset-0 z-[300] bg-[#1e1e1e]">{body}</div>
  }
  return body
}
