import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal as TerminalComponent, type ITheme } from '@baicie/xterm'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { handleXtermShortcut } from './use-terminal-shortcut-events'

let xtermErrorSuppressionUsers = 0
let originalConsoleError: typeof console.error | null = null
let suppressedParsingErrorCount = 0
let parsingErrorWarningTimer: ReturnType<typeof setTimeout> | null = null

const sharedXtermErrorHandler: typeof console.error = (...args: unknown[]) => {
  const message = typeof args[0] === 'string' ? args[0] : ''
  if (!message.includes('xterm.js: Parsing error')) {
    if (originalConsoleError) {
      Reflect.apply(originalConsoleError, console, args)
    }
    return
  }

  suppressedParsingErrorCount++
  if (suppressedParsingErrorCount !== 1) return
  parsingErrorWarningTimer = setTimeout(() => {
    if (suppressedParsingErrorCount > 1) {
      toast.warning(
        `xterm.js: ${suppressedParsingErrorCount - 1} VT sequence parsing errors suppressed`,
      )
    }
    suppressedParsingErrorCount = 0
    parsingErrorWarningTimer = null
  }, 5000)
}

function suppressXtermErrors() {
  if (xtermErrorSuppressionUsers === 0) {
    originalConsoleError = console.error
    console.error = sharedXtermErrorHandler
  }

  xtermErrorSuppressionUsers++
  let released = false
  return () => {
    if (released) return
    released = true
    xtermErrorSuppressionUsers--
    if (xtermErrorSuppressionUsers > 0) return

    if (console.error === sharedXtermErrorHandler && originalConsoleError) {
      console.error = originalConsoleError
    }
    originalConsoleError = null
    suppressedParsingErrorCount = 0
    if (parsingErrorWarningTimer) clearTimeout(parsingErrorWarningTimer)
    parsingErrorWarningTimer = null
  }
}

interface UseTerminalInstanceOptions {
  tabId: string
  workspaceId: string
  isMobile: boolean
  cursorBlink: boolean
  fontSize: number
  fontFamily: string
  theme: ITheme
  scrollback: number
  active: boolean
}

export function useTerminalInstance(options: UseTerminalInstanceOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<TerminalComponent | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const userZoomedRef = useRef(false)
  const activeRef = useRef(options.active)
  activeRef.current = options.active
  const [termInstance, setTermInstance] = useState<TerminalComponent | null>(
    null,
  )
  const [isReady, setIsReady] = useState(false)
  const [liveFontSize, setLiveFontSize] = useState(options.fontSize)

  useEffect(() => {
    if (!containerRef.current || !options.tabId) return
    const restoreErrors = suppressXtermErrors()
    const term = new TerminalComponent({
      cursorBlink: options.cursorBlink,
      fontSize: liveFontSize,
      fontFamily: options.fontFamily,
      theme: options.theme,
      scrollback: options.scrollback,
      macOptionIsMeta: !options.isMobile,
      allowTransparency: true,
      allowProposedApi: true,
    })
    termRef.current = term

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

    try {
      const webglAddon = new WebglAddon()
      webglAddon.onContextLoss(() => {
        console.warn(
          '[xterm] WebGL context lost, falling back to canvas renderer',
        )
        webglAddon.dispose()
      })
      term.loadAddon(webglAddon)
    } catch (error) {
      console.warn(
        '[xterm] WebGL addon unavailable, using default renderer:',
        error,
      )
    }

    term.attachCustomKeyEventHandler(event =>
      handleXtermShortcut(event, activeRef.current),
    )
    term.open(containerRef.current)
    setTermInstance(term)
    const initialFitTimer = window.setTimeout(() => {
      fitAddon.fit()
      if (activeRef.current) term.focus()
    }, 50)
    setIsReady(true)

    return () => {
      window.clearTimeout(initialFitTimer)
      restoreErrors()
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
      fitAddonRef.current?.fit()
      termRef.current?.focus()
    })
    return () => cancelAnimationFrame(animationFrame)
  }, [isReady, options.active])

  useEffect(() => {
    if (termRef.current) termRef.current.options.theme = options.theme
  }, [options.theme])

  useEffect(() => {
    if (!termRef.current) return
    if (userZoomedRef.current && liveFontSize !== options.fontSize) return
    userZoomedRef.current = false
    termRef.current.options.fontSize = options.fontSize
  }, [liveFontSize, options.fontSize])

  useEffect(() => {
    if (termRef.current)
      termRef.current.options.cursorBlink = options.cursorBlink
  }, [options.cursorBlink])

  useEffect(() => {
    if (!isReady) return
    let animationFrame: number | null = null
    const fit = () => {
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      animationFrame = requestAnimationFrame(() => {
        fitAddonRef.current?.fit()
        animationFrame = null
      })
    }
    const resizeObserver = new ResizeObserver(fit)
    const resizeTarget = termRef.current?.element ?? containerRef.current
    if (resizeTarget) resizeObserver.observe(resizeTarget)
    window.addEventListener('resize', fit)
    return () => {
      window.removeEventListener('resize', fit)
      if (animationFrame !== null) cancelAnimationFrame(animationFrame)
      resizeObserver.disconnect()
    }
  }, [isReady])

  const changeFontSize = (delta: number) => {
    const next = liveFontSize + delta
    if (next < 8 || next > 32) return
    userZoomedRef.current = true
    if (termInstance) {
      termInstance.options.fontSize = next
      fitAddonRef.current?.fit()
    }
    setLiveFontSize(next)
  }

  const resetFontSize = () => {
    userZoomedRef.current = false
    if (termInstance) {
      termInstance.options.fontSize = options.fontSize
      fitAddonRef.current?.fit()
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
    isReady,
    fontSize: liveFontSize,
    changeFontSize,
    resetFontSize,
  }
}
