/** Main xterm container and terminal-session coordinator. */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { useTerminal } from '@/hooks/use-terminal'
import { defaultSettings, type AppSettings } from '@/service/database'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { getThemeColors } from '@/utils/terminal-themes'
import { getReadableTerminalError } from '@/features/terminal/utils/readable-error'
import { getTemporaryTerminalProfile } from '@/features/terminal/services/temporary-terminal-profiles'
import { useSshHostKeyGate } from '@/features/terminal/hooks/use-ssh-host-key-gate'
import {
  SshHostKeyDialogSurface,
  SshHostKeyOverlaySurface,
} from './ssh-host-key-surfaces'
import { TerminalBody } from './terminal-body'
import { TerminalEmptyState } from './terminal-empty-state'
import { useTerminalInstance } from './use-terminal-instance'
import { useTerminalLongPress } from './use-terminal-long-press'
import { useTerminalShortcutEvents } from './use-terminal-shortcut-events'
import { useTerminalStatusEffects } from './use-terminal-status-effects'
import { useTabConnectionStatus } from './use-tab-connection-status'
import { useTabTitle } from './use-tab-title'
import type { ShellIntegrationEvent } from '@/features/terminal/services/terminal-shell-integration'
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
  const settings = useAppStore(state => state.config) as Partial<AppSettings>
  const appTheme = useAppStore(state => state.theme)
  const tab = useAppStore(state => state.tabs.find(item => item.id === tabId))
  const isActive = useAppStore(state => state.activeTabId === tabId)
  const savedHost = useHostStore(state =>
    tab?.hostId ? state.hosts.find(item => item.id === tab.hostId) : undefined,
  )
  const host = tab?.profileId
    ? getTemporaryTerminalProfile(tab.profileId)
    : savedHost
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
  const [shellCwd, setShellCwd] = useState<string | undefined>()

  const darkPreset =
    settings.terminalThemeDark ?? defaultSettings.terminalThemeDark
  const lightPreset =
    settings.terminalThemeLight ?? defaultSettings.terminalThemeLight
  const activeTheme =
    appTheme === 'light'
      ? lightPreset
      : appTheme === 'dark'
        ? darkPreset
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? darkPreset
          : lightPreset
  const theme = getThemeColors(activeTheme)
  const terminalIsActive = isActive && location.pathname === '/terminal'
  const onTitleChange = useTabTitle(tabId)

  const terminal = useTerminalInstance({
    tabId,
    workspaceId,
    isMobile,
    cursorBlink: settings.cursorBlink ?? defaultSettings.cursorBlink,
    cursorStyle: settings.cursorStyle ?? defaultSettings.cursorStyle,
    fontSize: settings.fontSize ?? defaultSettings.fontSize,
    fontFamily: settings.fontFamily ?? defaultSettings.fontFamily,
    theme,
    scrollback: settings.scrollback ?? defaultSettings.scrollback,
    allowProposedApi:
      settings.allowProposedApi ?? defaultSettings.allowProposedApi,
    active: terminalIsActive,
    onTitleChange,
    onShellIntegration: (event: ShellIntegrationEvent) => {
      if (event.kind === 'cwd') setShellCwd(event.cwd)
    },
  })
  const hostKeyGate = useSshHostKeyGate({
    tabType: tab?.type ?? 'local',
    host,
    jumpHost,
  })
  const { status, error, attempt, reason, write, reconnect, disconnect } =
    useTerminal(terminal.termInstance, {
      tabId,
      workspaceId,
      tabType: tab?.type ?? 'local',
      enabled: hostKeyGate.enabled,
      expectedHostKey: hostKeyGate.expectedHostKey,
      expectedJumpHostKey: hostKeyGate.expectedJumpHostKey,
      host,
      jumpHost,
      serialSessionId: tab?.serialSessionId,
      outputWriter: terminal.outputWriter ?? undefined,
    })
  const reconnectAction = hostKeyGate.enabled ? reconnect : hostKeyGate.retry
  const { isReady, requestFit } = terminal

  const readableError = error ? getReadableTerminalError(error, t) : null
  useTabConnectionStatus(tabId, status)
  useTerminalStatusEffects({
    status,
    error,
    readableError,
    errorTitle: t('terminal.errorTitle'),
    tab,
    host,
  })

  useEffect(() => {
    if (isReady) requestFit()
  }, [isReady, requestFit, status])

  useEffect(() => {
    if (terminalIsActive) return
    setIsFullscreen(false)
    setSearchOpen(false)
    setMobileMenuOpen(false)
  }, [terminalIsActive])

  useTerminalShortcutEvents({
    active: terminalIsActive,
    onReconnect: reconnectAction,
    onClear: () => terminal.termInstance?.clear(),
    onSearch: () => setSearchOpen(true),
    onZoomIn: () => terminal.changeFontSize(1),
    onZoomOut: () => terminal.changeFontSize(-1),
    onResetZoom: terminal.resetFontSize,
  })

  const longPress = useTerminalLongPress(() => setMobileMenuOpen(true))
  if (!tab) return <TerminalEmptyState />

  return (
    <>
      <div className="relative h-full">
        <TerminalBody
          tab={tab}
          host={host}
          status={status}
          readableError={readableError}
          reconnectAttempt={attempt}
          reconnectReason={reason}
          isMobile={isMobile}
          active={terminalIsActive}
          isFullscreen={isFullscreen}
          terminalFontSize={terminal.fontSize}
          terminalBackground={theme.background}
          shellCwd={shellCwd}
          term={terminal.termInstance}
          containerRef={terminal.containerRef}
          searchAddon={terminal.searchAddonRef.current}
          searchOpen={searchOpen}
          mobileMenuOpen={mobileMenuOpen}
          onSearchOpenChange={setSearchOpen}
          onMobileMenuOpenChange={setMobileMenuOpen}
          onSendKey={write}
          onFontSizeChange={terminal.changeFontSize}
          onResetFontSize={terminal.resetFontSize}
          onClear={() => terminal.termInstance?.clear()}
          toolSidebarOpen={toolSidebarOpen}
          onToggleToolSidebar={() => setToolSidebarOpen(current => !current)}
          onReconnect={reconnectAction}
          onDisconnect={disconnect}
          onToggleFullscreen={() => setIsFullscreen(current => !current)}
          onTouchStart={longPress.start}
          onTouchEnd={longPress.cancel}
          onTouchMove={longPress.move}
        />
        <SshHostKeyOverlaySurface gate={hostKeyGate} />
      </div>
      <SshHostKeyDialogSurface gate={hostKeyGate} />
    </>
  )
}

export default TerminalContainer
