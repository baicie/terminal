/**
 * TerminalContainer Component
 * 终端容器主组件
 */

import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal as TerminalComponent } from '@baicie/xterm'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { getThemeColors } from '@/utils/terminal-themes'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { useTerminal } from '@/hooks/use-terminal'
import { notify } from '@/service/notifications'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import {
  clearTerminalWriteFn,
  setTerminalWriteFn,
} from '@/features/terminal/contexts'
import { getReadableTerminalError } from '@/features/terminal/utils/readable-error'
import { TerminalKeyboardBar } from './keyboard-bar'
import { SessionStatusBar } from './session-status-bar'
import { TerminalContextMenu } from './terminal-context-menu'
import { TerminalMobileMenu } from './terminal-mobile-menu'
import { TerminalSearchOverlay } from './terminal-search-overlay'
import { TerminalCompletionOverlay } from '@/components/terminal-completion/terminal-completion-overlay'
import {
  extractCurrentWord,
  findAllMatches,
  getCursorScreenPosition,
  type CursorPosition,
  type CompletionItem,
} from '@/hooks/use-command-completion'
import { useRCCache } from '@/store/rc-cache'
import { parseShellRC, toCompletionItems } from '@/service/shell-rc'
import '@baicie/xterm/css/xterm.css'

/**
 * Suppresses xterm.js parsing errors that are caused by raw control sequences
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

export interface TerminalContainerProps {
  tabId: string
}

/**
 * TerminalContainer
 *
 * 终端容器主组件，管理 xterm.js 实例和终端会话。
 */
export function TerminalContainer({ tabId }: TerminalContainerProps) {
  const { t } = useTranslation()
  const tabs = useAppStore(s => s.tabs)
  const hosts = useHostStore(s => s.hosts)
  const settings = useAppStore(s => s.config) as Record<string, unknown>

  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<TerminalComponent | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const isMountedRef = useRef(false)
  const longPressRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null
    startX: number
    startY: number
    triggered: boolean
  }>({ timer: null, startX: 0, startY: 0, triggered: false })
  const [searchOpen, setSearchOpen] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Command completion state
  const [completionItems, setCompletionItems] = useState<CompletionItem[]>([])
  const [showCompletion, setShowCompletion] = useState(false)
  const [completionIndex, setCompletionIndex] = useState(0)
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({
    x: 0,
    y: 0,
  })

  const tab = tabs.find(t => t.id === tabId)
  const isMobile = useIsMobile()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fontSize, setFontSize] = useState(14)
  const [termInstance, setTermInstance] = useState<TerminalComponent | null>(
    null,
  )
  const [isReady, setIsReady] = useState(false)

  // Derive host from tab.hostId
  const host = tab?.hostId ? hosts.find(h => h.id === tab.hostId) : undefined

  const appTheme = useAppStore(s => s.theme)

  // Resolve the currently active terminal theme preset
  const darkPreset = (settings.terminalThemeDark as string) || 'one-dark'
  const lightPreset =
    (settings.terminalThemeLight as string) || 'solarized-light'

  const activeTerminalTheme = (() => {
    if (appTheme === 'light') return lightPreset
    if (appTheme === 'dark') return darkPreset
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? darkPreset
      : lightPreset
  })()

  const themeColors = getThemeColors(activeTerminalTheme as never)

  // Handle Tab press for command completion
  const handleTabPress = async (currentLine: string, cursorPos: number, history: string[]) => {
    const currentWord = extractCurrentWord(currentLine, cursorPos)

    if (!currentWord) {
      setShowCompletion(false)
      setCompletionItems([])
      return
    }

    const matches = await findAllMatches(currentWord, history, rcItemsRef.current)

    if (matches.length === 0) {
      setShowCompletion(false)
      setCompletionItems([])
      return
    }

    setCompletionItems(matches)
    setCompletionIndex(0)
    setShowCompletion(true)
    setCursorPosition(getCursorScreenPosition(termInstance) ?? { x: 0, y: 0 })
  }

  // Handle completion selection
  const handleCompletionSelect = (item: CompletionItem) => {
    if (!termInstance || completionItems.length === 0) return

    termInstance.write(item.text)
    setShowCompletion(false)
  }

  // Dismiss completion overlay
  const handleDismissCompletion = () => {
    setShowCompletion(false)
    termInstance?.focus()
  }

  // 终端数据流 hook
  // 注意：使用 termInstance state 而非 termRef.current，确保 React 能正确追踪
  // term 实例的创建/销毁，避免在第一次渲染时 termRef 还是 null 而错过 effect 触发
  const { status, error, sessionId } = useTerminal(termInstance, {
    tabType: tab?.type ?? 'local',
    host,
    serialSessionId: tab?.serialSessionId,
    onTabPress: handleTabPress,
  })

  // Shell RC cache - parse RC files when session connects
  const rcCache = useRCCache()
  useEffect(() => {
    if (!sessionId || status !== 'connected') return
    if (rcCache.has(sessionId)) return

    const sessionType = tab?.type === 'remote' ? 'ssh' : 'local'
    const shell = tab?.type === 'remote' ? 'bash' : 'bash'

    parseShellRC({ sessionId, sessionType, shell })
      .then(parsed => {
        rcCache.set(sessionId, toCompletionItems(parsed))
      })
      .catch(() => {})
  }, [sessionId, status, tab?.type, rcCache])

  // Get cached RC items for completion (ref to avoid stale closures in handleTabPress)
  const rcItemsRef = useRef<import('@/service/shell-rc').RCCompletionItem[]>([])
  rcItemsRef.current = rcCache.get(sessionId ?? '') ?? []

  const readableError = error ? getReadableTerminalError(error, t) : null

  // 连接失败时提示
  useEffect(() => {
    if (error) {
      toast.error(`${t('terminal.errorTitle')}: ${readableError ?? error}`)
    }
  }, [error, readableError, t])

  // 断连/出错时发系统通知（窗口失焦时弹原生 OS 通知）
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if (prev !== 'connected') return
    if (status !== 'disconnected' && status !== 'error') return
    if (!tab) return

    const target =
      tab.type === 'serial'
        ? `${tab.serialConfig?.port ?? tab.label}`
        : host
          ? `${host.username}@${host.hostname}`
          : tab.label
    const title =
      status === 'error'
        ? `Terminal error · ${target}`
        : `Disconnected · ${target}`
    void notify({
      title,
      body: readableError ?? undefined,
      type: status === 'error' ? 'error' : 'warning',
    })
  }, [status, error, tab, host, readableError, t])

  // 初始化 xterm
  // 仅依赖 tabId：tab 对象引用可能因 store 重渲染而变化，但只要 tabId 不变
  // 就不需要销毁/重建 xterm 实例（这会顺带关闭后端 session 并丢失内容）
  useEffect(() => {
    if (!containerRef.current || !tabId) return

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
    searchAddonRef.current = searchAddon
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

    // Load WebGL addon for improved rendering performance (large logs, high DPI)
    // Uses onDidLinkCall when available on WebGLAddon
    ;(async () => {
      try {
        const webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => {
          console.warn('[xterm] WebGL context lost, falling back to canvas renderer')
          webglAddon.dispose()
        })
        term.loadAddon(webglAddon)
      } catch (e) {
        console.warn('[xterm] WebGL addon unavailable, using default renderer:', e)
      }
    })()

    // 拦截 Cmd/Ctrl + F：触发自定义搜索浮层，阻止 xterm 默认处理
    term.attachCustomKeyEventHandler((e: { type: string; key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => {
      if (e.type !== 'keydown') return true

      // Cmd/Ctrl + F: open search
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'f' || e.key === 'F')) {
        setSearchOpen(true)
        return false
      }

      return true
    })

    term.open(containerRef.current!)

    // Register term instance and write function for mobile keyboard bar
    setTermInstance(term)
    setTerminalWriteFn((data: string) => {
      term.write(data)
    })

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
      searchAddonRef.current = null
      setTermInstance(null)
      setIsReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  // App 主题或预设变化时动态更新终端颜色
  useEffect(() => {
    if (!termRef.current) return
    termRef.current.options.theme = themeColors
  }, [themeColors])

  // Resize 监听
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

  // 状态变化时同步 fit
  useEffect(() => {
    if (isReady && fitAddonRef.current) {
      const rafId = requestAnimationFrame(() => {
        fitAddonRef.current?.fit()
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [isReady, status])

  // 空状态：无标签
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

  // 终端就绪后注册写函数
  const handleSendKey = (key: string) => {
    termInstance?.write(key)
  }

  const handleFontSizeChange = (delta: number) => {
    setFontSize(prev => {
      const next = prev + delta
      if (next < 8 || next > 32) return prev
      // Use type-safe approach since ITerminalOptions.set may not be in types
      ;(termInstance?.options as unknown as { set: (key: string, value: number) => void }).set('fontSize', next)
      fitAddonRef.current?.fit()
      return next
    })
  }

  const toggleFullscreen = () => {
    setIsFullscreen(p => !p)
  }

  // 仅在桌面端 + 非全屏时显示状态条
  const showStatusBar = !isMobile && !isFullscreen

  const startLongPress = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return
    const t0 = e.touches[0]
    longPressRef.current.startX = t0.clientX
    longPressRef.current.startY = t0.clientY
    longPressRef.current.triggered = false
    longPressRef.current.timer = setTimeout(() => {
      longPressRef.current.triggered = true
      setMobileMenuOpen(true)
      // 触发系统震动反馈（Android）
      try {
        navigator.vibrate?.(15)
      } catch {
        /* noop */
      }
    }, 500)
  }

  const cancelLongPress = () => {
    if (longPressRef.current.timer) {
      clearTimeout(longPressRef.current.timer)
      longPressRef.current.timer = null
    }
  }

  const moveLongPress = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!longPressRef.current.timer) return
    const t0 = e.touches[0]
    if (!t0) return
    const dx = Math.abs(t0.clientX - longPressRef.current.startX)
    const dy = Math.abs(t0.clientY - longPressRef.current.startY)
    if (dx > 10 || dy > 10) cancelLongPress()
  }

  // 终端主体
  const terminalBody = (
    <div className="h-full flex bg-[#1e1e1e]">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {showStatusBar && (
          <SessionStatusBar
            tab={tab}
            host={host}
            status={status}
            errorMessage={readableError ?? undefined}
          />
        )}
        {/* Terminal area: relative wrapper 用于挂载搜索浮层 */}
        <div className="relative flex-1 min-h-0">
          {isMobile ? (
            <div
              ref={containerRef}
              className="absolute inset-0 overflow-hidden"
              tabIndex={0}
              role="application"
              aria-label="Terminal"
              style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
              onTouchStart={startLongPress}
              onTouchEnd={cancelLongPress}
              onTouchCancel={cancelLongPress}
              onTouchMove={moveLongPress}
            />
          ) : (
            <TerminalContextMenu
              term={termInstance}
              onFontSizeChange={delta => handleFontSizeChange(delta)}
              onOpenSearch={() => setSearchOpen(true)}
            >
              <div
                ref={containerRef}
                className="absolute inset-0 overflow-hidden focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
                tabIndex={0}
                role="application"
                aria-label="Terminal"
                style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
              />
            </TerminalContextMenu>
          )}
          {!isMobile && (
            <TerminalSearchOverlay
              open={searchOpen}
              onClose={() => {
                setSearchOpen(false)
                termInstance?.focus()
              }}
              searchAddon={searchAddonRef.current}
            />
          )}
          {/* Command completion overlay */}
          {showCompletion && (
            <TerminalCompletionOverlay
              items={completionItems}
              currentIndex={completionIndex}
              position={cursorPosition}
              onSelect={(item, index) => {
                setCompletionIndex(index)
                handleCompletionSelect(item)
              }}
              onDismiss={handleDismissCompletion}
            />
          )}
          {isMobile && (
            <TerminalMobileMenu
              term={termInstance}
              onFontSizeChange={delta => handleFontSizeChange(delta)}
              open={mobileMenuOpen}
              onOpenChange={setMobileMenuOpen}
            />
          )}
        </div>
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
      <div className="fixed inset-0 z-[300] bg-[#1e1e1e]">{terminalBody}</div>
    )
  }

  return terminalBody
}

export default TerminalContainer
