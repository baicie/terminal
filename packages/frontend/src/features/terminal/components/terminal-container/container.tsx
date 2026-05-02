/**
 * TerminalContainer Component
 * 终端容器主组件
 */

import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal as TerminalComponent } from '@baicie/xterm'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getThemeColors } from '@/utils/terminal-themes'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { useTerminal } from '@/hooks/use-terminal'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import {
  clearTerminalWriteFn,
  setTerminalWriteFn,
} from '@/view/terminal/terminal-write-context'
import { TerminalKeyboardBar } from './keyboard-bar'
import { SessionStatusBar } from './session-status-bar'
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

  // 终端数据流 hook
  // 注意：使用 termInstance state 而非 termRef.current，确保 React 能正确追踪
  // term 实例的创建/销毁，避免在第一次渲染时 termRef 还是 null 而错过 effect 触发
  const { status, error } = useTerminal(termInstance, {
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
      termInstance?.options.set('fontSize', next)
      fitAddonRef.current?.fit()
      return next
    })
  }

  const toggleFullscreen = () => {
    setIsFullscreen(p => !p)
  }

  // 仅在桌面端 + 非全屏时显示状态条
  const showStatusBar = !isMobile && !isFullscreen

  // 终端主体
  const terminalBody = (
    <div className="h-full flex bg-[#1e1e1e]">
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {showStatusBar && (
          <SessionStatusBar tab={tab} host={host} status={status} />
        )}
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
      <div className="fixed inset-0 z-[300] bg-[#1e1e1e]">{terminalBody}</div>
    )
  }

  return terminalBody
}

export default TerminalContainer
