import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal as TerminalComponent } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getThemeColors } from '@/utils/terminal-themes'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { useTerminal } from '@/hooks/use-terminal'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { clearTerminalWriteFn, setTerminalWriteFn } from './terminal-write-context'
import TerminalKeyboardBar from './terminal-keyboard-bar'
import '@xterm/xterm/css/xterm.css'

/**
 * Suppresses xterm.js parsing errors (code 127 / VT sequence errors) that are
 * caused by raw control sequences emitted by the local shell (e.g. DECSSE,
 * DECFRA, or UTF-8 private-use sequences that xterm.js cannot parse).
 * These errors are harmless — the terminal still works correctly.
 *
 * Returns a restore function — call it in the useEffect cleanup.
 */
function suppressXtermErrors() {
  const orig = console.error.bind(console)
  let count = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  console.error = (...args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : ''
    if (msg.includes('xterm.js: Parsing error')) {
      count++
      if (count === 1) {
        timer = setTimeout(() => {
          if (count > 1) {
            toast.warning(
              `xterm.js: ${count - 1} VT sequence parsing errors suppressed`,
            )
          }
          count = 0
        }, 5000)
      }
      return
    }
    orig(...args)
  }

  return () => {
    console.error = orig
    if (timer) clearTimeout(timer)
  }
}

interface TerminalContainerProps {
  tabId: string
}

const TerminalContainer: React.FC<TerminalContainerProps> = ({ tabId }) => {
  const tabs = useAppStore(s => s.tabs)
  const hosts = useHostStore(s => s.hosts)
  const settings = useAppStore(s => s.config) as Record<string, unknown>

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<TerminalComponent | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const isMountedRef = useRef(false)

  const tab = tabs.find(t => t.id === tabId)
  const isMobile = useIsMobile()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fontSize, setFontSize] = useState(14)
  const [termInstance, setTermInstance] = useState<TerminalComponent | null>(null)
  const [isReady, setIsReady] = useState(false)

  // Derive host from tab.hostId
  const host = tab?.hostId ? hosts.find(h => h.id === tab.hostId) : undefined

  const appTheme = useAppStore(s => s.theme)

  // Resolve the currently active terminal theme preset (settings + system preference)
  const darkPreset = (settings.terminalThemeDark as string) || 'one-dark'
  const lightPreset = (settings.terminalThemeLight as string) || 'solarized-light'

  const activeTerminalTheme = (() => {
    if (appTheme === 'light') return lightPreset
    if (appTheme === 'dark') return darkPreset
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? darkPreset
      : lightPreset
  })()

  const themeColors = getThemeColors(activeTerminalTheme as never)

  // ---- 终端数据流 hook ----
  const termForHook = termRef.current
  const { status, error } = useTerminal(termForHook, {
    tabType: tab?.type ?? 'local',
    host,
    serialSessionId: tab?.serialSessionId,
  })

  // 连接失败时提示
  useEffect(() => {
    if (error) {
      toast.error(`Terminal error: ${error}`)
    }
  }, [error])

  // ---- 初始化 xterm ----
  useEffect(() => {
    if (!containerRef.current || !tab) return

    const restore = suppressXtermErrors()

    const term = new TerminalComponent({
      cursorBlink: true,
      fontSize,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: themeColors,
      scrollback: 10000,
      macOptionIsMeta: !isMobile,
      allowTransparency: true,
      allowProposedApi: true,
    })

    termRef.current = term

    // Load addons
    const fitAddon = new FitAddon()
    fitAddonRef.current = fitAddon
    term.loadAddon(fitAddon)

    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)

    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(webLinksAddon)

    const unicodeAddon = new Unicode11Addon()
    term.loadAddon(unicodeAddon)
    term.unicode.activeVersion = '11'

    // Load clipboard addon dynamically
    ;(async () => {
      try {
        const { ClipboardAddon } = await import('@xterm/addon-clipboard')
        term.loadAddon(new ClipboardAddon())
      } catch (e) {
        console.warn('Failed to load ClipboardAddon:', e)
      }
    })()

    term.open(containerRef.current!)

    // Register term instance and write function for mobile keyboard bar
    setTermInstance(term)
    setTerminalWriteFn((data: string) => { term.write(data) })

    setTimeout(() => {
      fitAddon.fit()
      term.focus()
    }, 50)

    setIsReady(true)
    isMountedRef.current = true

    return () => {
      restore()
      isMountedRef.current = false
      clearTerminalWriteFn()
      term.dispose()
      termRef.current = null
      setTermInstance(null)
      setIsReady(false)
    }
  }, [tabId, tab])

  // ---- App 主题或预设变化时动态更新终端颜色 ----
  useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.theme = themeColors
  }, [themeColors])

  // ---- Resize 监听 ----
  useEffect(() => {
    if (!isReady) return

    let rafId: number | null = null

    const handleWindowResize = () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        fitAddonRef.current?.fit()
        rafId = null
      })
    }

    const resizeObserver = new ResizeObserver(() => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        fitAddonRef.current?.fit()
        rafId = null
      })
    })

    if (containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    window.addEventListener('resize', handleWindowResize)

    return () => {
      window.removeEventListener('resize', handleWindowResize)
      if (rafId !== null) cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
    }
  }, [isReady])

  // ---- 状态变化时同步 fit ----
  useEffect(() => {
    if (isReady && fitAddonRef.current) {
      const rafId = requestAnimationFrame(() => {
        fitAddonRef.current?.fit()
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [isReady, status])

  // ─── 空状态：无标签 ──────────────────────────────────────────────
  if (!tab) {
    return (
      <div className="h-full flex items-center justify-center bg-[#1e1e1e]">
        <div className="text-center max-w-sm">
          <p className="text-[#888] mb-2 text-sm font-medium">
            No active session
          </p>
          <p className="text-[#555] text-xs">
            Select a host from the sidebar or press{' '}
            <kbd className="px-1 py-0.5 bg-[#333] rounded text-[#aaa] font-mono text-[10px]">
              Ctrl+T
            </kbd>{' '}
            to open a local terminal.
          </p>
        </div>
      </div>
    )
  }

  // ─── 终端就绪后注册写函数 ────────────────────────────────────────
  const handleSendKey = (key: string) => {
    termInstance?.write(key)
  }

  const handleFontSizeChange = (delta: number) => {
    setFontSize(prev => {
      const next = prev + delta
      if (next < 8 || next > 32) return prev
      termInstance?.options.set('fontSize', next)
      fitAddonRef.current?.fit()
      return next
    })
  }

  const toggleFullscreen = () => {
    setIsFullscreen(p => !p)
  }

  // ─── 终端主体 ─────────────────────────────────────────────────────
  const terminalBody = (
    <div className="h-full flex bg-[#1e1e1e]">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Terminal area */}
        <div
          ref={containerRef}
          className="flex-1 overflow-hidden"
          tabIndex={0}
          style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
        />
        {/* Mobile keyboard bar */}
        {isMobile && (
          <TerminalKeyboardBar
            onSendKey={handleSendKey}
            onFontSizeChange={handleFontSizeChange}
            fontSize={fontSize}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
          />
        )}
      </div>
    </div>
  )

  // Mobile fullscreen: hide everything except terminal + keyboard bar
  if (isMobile && isFullscreen) {
    return (
      <div className="fixed inset-0 z-[300] bg-[#1e1e1e]">
        {terminalBody}
      </div>
    )
  }

  return terminalBody
}

export default TerminalContainer
export { TerminalContainer }
