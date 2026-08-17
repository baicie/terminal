/** Main xterm container and terminal-session coordinator. */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { useTerminal } from '@/hooks/use-terminal'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { getThemeColors } from '@/utils/terminal-themes'
import { getReadableTerminalError } from '@/features/terminal/utils/readable-error'
import { TerminalBody } from './terminal-body'
import { TerminalEmptyState } from './terminal-empty-state'
import { useShellRcCompletion } from './use-shell-rc-completion'
import { useTerminalCompletion } from './use-terminal-completion'
import { useTerminalInstance } from './use-terminal-instance'
import { useTerminalLongPress } from './use-terminal-long-press'
import { useTerminalShortcutEvents } from './use-terminal-shortcut-events'
import { useTerminalStatusEffects } from './use-terminal-status-effects'
import '@baicie/xterm/css/xterm.css'

export interface TerminalContainerProps {
  tabId: string
  workspaceId: string
}

export function TerminalContainer({
  tabId,
  workspaceId,
}: TerminalContainerProps) {
  const { t } = useTranslation()
  const location = useLocation()
  const settings = useAppStore(state => state.config) as Record<string, unknown>
  const appTheme = useAppStore(state => state.theme)
  const tab = useAppStore(state => state.tabs.find(item => item.id === tabId))
  const isActive = useAppStore(state => state.activeTabId === tabId)
  const host = useHostStore(state =>
    tab?.hostId ? state.hosts.find(item => item.id === tab.hostId) : undefined,
  )
  const jumpHost = useHostStore(state =>
    host?.jumpHostId
      ? state.hosts.find(item => item.id === host.jumpHostId)
      : undefined,
  )
  const isMobile = useIsMobile()
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [toolSidebarOpen, setToolSidebarOpen] = useState(false)

  const darkPreset = (settings.terminalThemeDark as string) || 'one-dark'
  const lightPreset =
    (settings.terminalThemeLight as string) || 'solarized-light'
  const activeTheme =
    appTheme === 'light'
      ? lightPreset
      : appTheme === 'dark'
        ? darkPreset
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? darkPreset
          : lightPreset
  const theme = getThemeColors(activeTheme as never)
  const cursorBlink =
    settings.terminalCursorBlink !== undefined
      ? Boolean(settings.terminalCursorBlink)
      : true
  const fontSize = Number(settings.terminalFontSize ?? 14)
  const fontFamily =
    (settings.terminalFontFamily as string) ||
    "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace"
  const scrollback = Number(settings.terminalScrollback ?? 10000)
  const terminalIsActive = isActive && location.pathname === '/terminal'

  const terminal = useTerminalInstance({
    tabId,
    workspaceId,
    isMobile,
    cursorBlink,
    fontSize,
    fontFamily,
    theme,
    scrollback,
    active: terminalIsActive,
  })
  const completion = useTerminalCompletion(terminal.termInstance)
  const { status, error, sessionId, write, reconnect, disconnect } =
    useTerminal(terminal.termInstance, {
      tabId,
      workspaceId,
      tabType: tab?.type ?? 'local',
      host,
      jumpHost,
      serialSessionId: tab?.serialSessionId,
      onTabPress: completion.handleTabPress,
    })
  useShellRcCompletion(sessionId, status, tab?.type, completion.rcItemsRef)

  const readableError = error ? getReadableTerminalError(error, t) : null
  useTerminalStatusEffects({
    status,
    error,
    readableError,
    errorTitle: t('terminal.errorTitle'),
    tab,
    host,
  })

  useEffect(() => {
    if (!terminal.isReady || !terminal.fitAddonRef.current) return
    const animationFrame = requestAnimationFrame(() => {
      terminal.fitAddonRef.current?.fit()
    })
    return () => cancelAnimationFrame(animationFrame)
  }, [terminal.isReady, terminal.fitAddonRef, status])

  useEffect(() => {
    if (terminalIsActive) return
    setIsFullscreen(false)
    setSearchOpen(false)
    setMobileMenuOpen(false)
  }, [terminalIsActive])

  useTerminalShortcutEvents({
    active: terminalIsActive,
    onReconnect: reconnect,
    onClear: () => terminal.termInstance?.clear(),
    onSearch: () => setSearchOpen(true),
    onZoomIn: () => terminal.changeFontSize(1),
    onZoomOut: () => terminal.changeFontSize(-1),
    onResetZoom: terminal.resetFontSize,
  })

  const longPress = useTerminalLongPress(() => setMobileMenuOpen(true))
  if (!tab) return <TerminalEmptyState />

  return (
    <TerminalBody
      tab={tab}
      host={host}
      status={status}
      readableError={readableError}
      isMobile={isMobile}
      active={terminalIsActive}
      isFullscreen={isFullscreen}
      terminalFontSize={terminal.fontSize}
      terminalBackground={theme.background}
      term={terminal.termInstance}
      containerRef={terminal.containerRef}
      searchAddon={terminal.searchAddonRef.current}
      searchOpen={searchOpen}
      mobileMenuOpen={mobileMenuOpen}
      completion={completion}
      onSearchOpenChange={setSearchOpen}
      onMobileMenuOpenChange={setMobileMenuOpen}
      onSendKey={write}
      onFontSizeChange={terminal.changeFontSize}
      onResetFontSize={terminal.resetFontSize}
      onClear={() => terminal.termInstance?.clear()}
      toolSidebarOpen={toolSidebarOpen}
      onToggleToolSidebar={() => setToolSidebarOpen(current => !current)}
      onReconnect={reconnect}
      onDisconnect={disconnect}
      onToggleFullscreen={() => setIsFullscreen(current => !current)}
      onTouchStart={longPress.start}
      onTouchEnd={longPress.cancel}
      onTouchMove={longPress.move}
    />
  )
}

export default TerminalContainer
