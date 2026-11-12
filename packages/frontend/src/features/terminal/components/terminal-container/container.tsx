/** Main xterm container and terminal-session coordinator. */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useLocation } from 'react-router-dom'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { defaultSettings, type AppSettings } from '@/service/database'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { getThemeColors } from '@/utils/terminal-themes'
import { getTemporaryTerminalProfile } from '@/features/terminal/services/temporary-terminal-profiles'
import {
  SshHostKeyDialogSurface,
  SshHostKeyOverlaySurface,
} from './ssh-host-key-surfaces'
import { PasteConfirmDialog } from './paste-confirm-dialog'
import { usePasteConfirm } from './use-paste-confirm'
import { usePaneShortcuts } from './use-pane-shortcuts'
import { useTerminalPaneUi } from './use-terminal-pane-ui'
import { usePublishTerminalSize } from './use-publish-terminal-size'
import { useTerminalBodyProps } from './use-terminal-body-props'
import { useTerminalErrorSurface } from './use-terminal-error-dismissal'
import { TerminalBody } from './terminal-body'
import { TerminalEmptyState } from './terminal-empty-state'
import { useTerminalInstance } from './use-terminal-instance'

import { useRemotePromptProbe } from './use-remote-prompt-probe'
import { useTerminalActivePreset } from './use-terminal-active-preset'
import { useTerminalSessionBinding } from './use-terminal-session-binding'

import { useTerminalStatusEffects } from './use-terminal-status-effects'
import { useTabConnectionStatus } from './use-tab-connection-status'
import { useTabTitle } from './use-tab-title'
import '@baicie/xterm/css/xterm.css'
import { isTerminalPath } from '@/router/terminal-route'

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
  const updateTab = useAppStore(state => state.updateTab)
  const isActive = useAppStore(state => state.activeTabId === tabId)
  const savedHost = useHostStore(state =>
    tab?.hostId ? state.hosts.find(item => item.id === tab.hostId) : undefined,
  )
  const host = tab?.profileId ? getTemporaryTerminalProfile(tab.profileId) : savedHost
  const jumpHost = useHostStore(state =>
    host?.jumpHostId ? state.hosts.find(item => item.id === host.jumpHostId) : undefined,
  )
  const isMobile = useIsMobile()
  const ui = useTerminalPaneUi()
  const remotePrompt = useRemotePromptProbe({
    tabId,
    isRemote: tab?.type === 'remote',
  })
  const darkPreset =
    settings.terminalThemeDark ?? defaultSettings.terminalThemeDark
  const lightPreset =
    settings.terminalThemeLight ?? defaultSettings.terminalThemeLight
  const activeTheme = useTerminalActivePreset({ appTheme, dark: darkPreset, light: lightPreset })
  const theme = getThemeColors(activeTheme)
  const terminalIsActive = isActive && isTerminalPath(location.pathname)
  const onTitleChange = useTabTitle(tabId)
  const pasteConfirm = usePasteConfirm()

  const terminal = useTerminalInstance({
    tabId,
    workspaceId,
    terminalType: tab?.type ?? 'missing',
    tabAvailable: tab !== undefined,
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
    onConfirmRiskyPaste: pasteConfirm.confirm,
    onShellIntegration: event => {
      if (event.kind === 'cwd') ui.setShellCwd(event.cwd)
      else if (event.kind === 'command-finished') ui.setLastExitCode(event.exitCode)
      remotePrompt.onShellIntegration(event)
    },
  })
  remotePrompt.inputRef.current = terminal.termInstance
    ? (data, wasUserInput) => terminal.termInstance?.input(data, wasUserInput)
    : undefined
  const onUserInput = (event?: { wasUserInput?: boolean }) => {
    if (event?.wasUserInput === false) return
    if (tab?.startupFallback && !tab.startupFallbackInteracted) {
      updateTab(tabId, { startupFallbackInteracted: true })
    }
  }
  const session = useTerminalSessionBinding({
    termInstance: terminal.termInstance,
    tabId,
    workspaceId,
    tab,
    host,
    jumpHost,
    outputWriter: terminal.outputWriter ?? undefined,
    onOutput: remotePrompt.onOutput,
    onInput: onUserInput,
  })
  const { status, error, write } = session
  const { disconnect, reconnectAction, hostKeyGate } = session
  const { isReady, requestFit } = terminal
  const errorSurface = useTerminalErrorSurface(error)
  const { readableError } = errorSurface
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
  usePublishTerminalSize({
    tabId,
    isActive,
    isReady,
    term: terminal.termInstance,
    status,
    sessionType: tab?.type ?? 'local',
  })
  useEffect(() => {
    if (terminalIsActive) return
    ui.setIsFullscreen(false)
    ui.setSearchOpen(false)
    ui.setMobileMenuOpen(false)
    // `ui` keeps its identity across renders that do not change pane UI state
    // (see useTerminalPaneUi), so this does not re-run every frame.
  }, [terminalIsActive, ui])

  const longPress = usePaneShortcuts({
    active: terminalIsActive,
    term: terminal.termInstance,
    reconnectAction,
    onSearch: () => ui.setSearchOpen(true),
    onZoomIn: () => terminal.changeFontSize(1),
    onZoomOut: () => terminal.changeFontSize(-1),
    onResetZoom: terminal.resetFontSize,
    onLongPress: () => ui.setMobileMenuOpen(true),
  })
  const bodyProps = useTerminalBodyProps({
    tab: tab ?? null,
    host,
    session: { ...session, disconnect, reconnectAction },
    errorSurface,
    isMobile,
    terminalIsActive,
    containerRef: terminal.containerRef,
    term: terminal.termInstance,
    searchAddon: terminal.searchAddonRef.current,
    themeBackground: theme.background,
    ui,
    terminal: {
      fontSize: terminal.fontSize,
      changeFontSize: terminal.changeFontSize,
      resetFontSize: terminal.resetFontSize,
    },
    write,
    longPress,
  })
  if (!tab) return <TerminalEmptyState />
  return (
    <>
      <PasteConfirmDialog request={pasteConfirm.request} onResolve={pasteConfirm.resolve} />
      <div className="relative h-full">
        <TerminalBody {...bodyProps} />
        <SshHostKeyOverlaySurface gate={hostKeyGate} />
      </div>
      <SshHostKeyDialogSurface gate={hostKeyGate} />
    </>
  )
}

export default TerminalContainer
