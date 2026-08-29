import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal as TerminalComponent, type ITheme } from '@baicie/xterm'
import { useCallback, useEffect, useRef, useState } from 'react'
import { handleXtermShortcut } from './use-terminal-shortcut-events'
import {
  ShellIntegrationState,
  type ShellIntegrationEvent,
} from '@/features/terminal/services/terminal-shell-integration'
import { TerminalViewportController } from './terminal-viewport-controller'
import { useTerminalWebgl } from './use-terminal-webgl'

interface UseTerminalInstanceOptions {
  tabId: string
  workspaceId: string
  isMobile: boolean
  cursorBlink: boolean
  cursorStyle: 'block' | 'underline' | 'bar'
  fontSize: number
  fontFamily: string
  theme: ITheme
  scrollback: number
  allowProposedApi: boolean
  active: boolean
  onTitleChange?: (title: string) => void
  onShellIntegration?: (event: ShellIntegrationEvent) => void
}

export function useTerminalInstance(options: UseTerminalInstanceOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<TerminalComponent | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const viewportControllerRef = useRef<TerminalViewportController | null>(null)
  const userZoomedRef = useRef(false)
  const configuredFontSizeRef = useRef(options.fontSize)
  const onTitleChangeRef = useRef(options.onTitleChange)
  const onShellIntegrationRef = useRef(options.onShellIntegration)
  const activeRef = useRef(options.active)
  activeRef.current = options.active
  onTitleChangeRef.current = options.onTitleChange
  onShellIntegrationRef.current = options.onShellIntegration
  const [termInstance, setTermInstance] = useState<TerminalComponent | null>(
    null,
  )
  const [isReady, setIsReady] = useState(false)
  const [liveFontSize, setLiveFontSize] = useState(options.fontSize)

  const requestFit = useCallback(() => {
    viewportControllerRef.current?.requestFit()
  }, [])
  const refreshViewport = useCallback(() => {
    viewportControllerRef.current?.refresh()
  }, [])
  useTerminalWebgl({
    term: termInstance,
    active: options.active,
    ready: isReady,
    refresh: refreshViewport,
  })

  useEffect(() => {
    if (!containerRef.current || !options.tabId) return
    const term = new TerminalComponent({
      cursorBlink: options.cursorBlink,
      cursorStyle: options.cursorStyle,
      fontSize: liveFontSize,
      fontFamily: options.fontFamily,
      theme: options.theme,
      scrollback: options.scrollback,
      macOptionIsMeta: !options.isMobile,
      allowTransparency: true,
      allowProposedApi: options.allowProposedApi,
    })
    termRef.current = term
    const titleDisposable = term.onTitleChange(title => {
      onTitleChangeRef.current?.(title)
    })
    const shellIntegrationState = new ShellIntegrationState()
    const shellIntegrationDisposables = [133, 7].map(identifier =>
      term.parser.registerOscHandler(identifier, data => {
        const event = shellIntegrationState.consume(identifier, data)
        if (!event) return false
        onShellIntegrationRef.current?.(event)
        return true
      }),
    )

    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)
    const searchAddon = new SearchAddon()
    searchAddonRef.current = searchAddon
    term.loadAddon(searchAddon)
    term.loadAddon(new WebLinksAddon())
    term.loadAddon(new Unicode11Addon())
    term.unicode.activeVersion = '11'

    void import('@xterm/addon-clipboard')
      .then(({ ClipboardAddon }) => term.loadAddon(new ClipboardAddon()))
      .catch(error => console.warn('Failed to load ClipboardAddon:', error))

    term.attachCustomKeyEventHandler(event =>
      handleXtermShortcut(event, activeRef.current),
    )
    term.open(containerRef.current)
    const initialDimensions = fitAddon.proposeDimensions()
    if (
      initialDimensions &&
      Number.isInteger(initialDimensions.cols) &&
      Number.isInteger(initialDimensions.rows) &&
      initialDimensions.cols > 0 &&
      initialDimensions.rows > 0
    ) {
      term.resize(initialDimensions.cols, initialDimensions.rows)
    }
    const viewportController = new TerminalViewportController(
      term,
      () => fitAddon.fit(),
      term.element ?? containerRef.current,
    )
    viewportController.attach()
    viewportControllerRef.current = viewportController
    setTermInstance(term)
    const initialFitTimer = window.setTimeout(() => {
      viewportController.fitNow()
      if (activeRef.current) term.focus()
    }, 50)
    setIsReady(true)

    return () => {
      window.clearTimeout(initialFitTimer)
      viewportController.dispose()
      if (viewportControllerRef.current === viewportController) {
        viewportControllerRef.current = null
      }
      titleDisposable.dispose()
      for (const disposable of shellIntegrationDisposables) disposable.dispose()
      term.dispose()
      termRef.current = null
      searchAddonRef.current = null
      setTermInstance(null)
      setIsReady(false)
    }
    // Recreating xterm for store object changes closes the backend session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.tabId, options.workspaceId])

  useEffect(() => {
    if (!options.active || !isReady) return
    const animationFrame = requestAnimationFrame(() => {
      viewportControllerRef.current?.reactivate()
      termRef.current?.focus()
    })
    return () => cancelAnimationFrame(animationFrame)
  }, [isReady, options.active])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = options.theme
  }, [options.theme])

  useEffect(() => {
    const settingChanged = configuredFontSizeRef.current !== options.fontSize
    configuredFontSizeRef.current = options.fontSize
    if (settingChanged) {
      userZoomedRef.current = false
      setLiveFontSize(options.fontSize)
    }
    if (!termRef.current || (userZoomedRef.current && !settingChanged)) return
    termRef.current.options.fontSize = options.fontSize
    viewportControllerRef.current?.requestFit()
  }, [options.fontSize])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.cursorBlink = options.cursorBlink
    term.options.cursorStyle = options.cursorStyle
    term.options.scrollback = options.scrollback
    term.options.allowProposedApi = options.allowProposedApi
  }, [
    options.allowProposedApi,
    options.cursorBlink,
    options.cursorStyle,
    options.scrollback,
  ])

  useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.fontFamily = options.fontFamily
    viewportControllerRef.current?.requestFit()
  }, [options.fontFamily])

  useEffect(() => {
    if (!isReady) return
    const requestFit = () => viewportControllerRef.current?.requestFit()
    const resizeObserver = new ResizeObserver(requestFit)
    const resizeTarget = termRef.current?.element ?? containerRef.current
    if (resizeTarget) resizeObserver.observe(resizeTarget)
    window.addEventListener('resize', requestFit)
    return () => {
      window.removeEventListener('resize', requestFit)
      resizeObserver.disconnect()
    }
  }, [isReady])

  const changeFontSize = (delta: number) => {
    const next = liveFontSize + delta
    if (next < 8 || next > 32) return
    userZoomedRef.current = true
    if (termInstance) {
      termInstance.options.fontSize = next
      viewportControllerRef.current?.fitNow()
    }
    setLiveFontSize(next)
  }

  const resetFontSize = () => {
    userZoomedRef.current = false
    if (termInstance) {
      termInstance.options.fontSize = options.fontSize
      viewportControllerRef.current?.fitNow()
      termInstance.focus()
    }
    setLiveFontSize(options.fontSize)
  }

  return {
    containerRef,
    termRef,
    fitAddonRef,
    searchAddonRef,
    termInstance,
    outputWriter: viewportControllerRef.current ?? termInstance,
    requestFit,
    isReady,
    fontSize: liveFontSize,
    changeFontSize,
    resetFontSize,
  }
}
