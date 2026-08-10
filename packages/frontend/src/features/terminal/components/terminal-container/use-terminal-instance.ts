import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal as TerminalComponent, type ITheme } from '@baicie/xterm'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  clearTerminalWriteFn,
  setTerminalWriteFn,
} from '@/features/terminal/contexts'

function suppressXtermErrors() {
  const originalError = console.error.bind(console)
  let count = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  console.error = (...args: unknown[]) => {
    const message = typeof args[0] === 'string' ? args[0] : ''
    if (!message.includes('xterm.js: Parsing error')) {
      originalError(...args)
      return
    }
    count++
    if (count === 1) {
      timer = setTimeout(() => {
        if (count > 1) {
          toast.warning(
            'xterm.js: ' +
              (count - 1) +
              ' VT sequence parsing errors suppressed',
          )
        }
        count = 0
      }, 5000)
    }
  }
  return () => {
    console.error = originalError
    if (timer) clearTimeout(timer)
  }
}

interface UseTerminalInstanceOptions {
  tabId: string
  isMobile: boolean
  cursorBlink: boolean
  fontSize: number
  fontFamily: string
  theme: ITheme
  scrollback: number
  onOpenSearch: () => void
}

export function useTerminalInstance(options: UseTerminalInstanceOptions) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<TerminalComponent | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const userZoomedRef = useRef(false)
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

    term.attachCustomKeyEventHandler(event => {
      if (event.type !== 'keydown') return true
      if (
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        (event.key === 'f' || event.key === 'F')
      ) {
        options.onOpenSearch()
        return false
      }
      return true
    })
    term.open(containerRef.current)
    setTermInstance(term)
    setTerminalWriteFn(data => term.write(data))
    setTimeout(() => {
      fitAddon.fit()
      term.focus()
    }, 50)
    setIsReady(true)

    return () => {
      restoreErrors()
      clearTerminalWriteFn()
      term.dispose()
      termRef.current = null
      searchAddonRef.current = null
      setTermInstance(null)
      setIsReady(false)
    }
    // Recreating xterm for store object changes closes the backend session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.tabId])

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
    if (containerRef.current) resizeObserver.observe(containerRef.current)
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

  return {
    containerRef,
    termRef,
    fitAddonRef,
    searchAddonRef,
    termInstance,
    isReady,
    changeFontSize,
  }
}
