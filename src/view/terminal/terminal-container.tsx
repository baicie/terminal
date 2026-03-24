import { useEffect, useRef, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { useInjectable } from '@/hooks/use-di'
import { AppStore } from '@/store/app'
import { Terminal as TerminalComponent } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalContainerProps {
  tabId: string
}

const TerminalContainer: React.FC<TerminalContainerProps> = observer(
  ({ tabId }) => {
    const app = useInjectable(AppStore)

    const containerRef = useRef<HTMLDivElement>(null)
    const termRef = useRef<TerminalComponent | null>(null)
    const fitAddonRef = useRef<FitAddon | null>(null)
    const isMountedRef = useRef(false)

    const tab = app.tabs.find(t => t.id === tabId)
    const [isReady, setIsReady] = useState(false)

    // Initialize xterm
    useEffect(() => {
      if (!containerRef.current || !tab) return

      const term = new TerminalComponent({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        theme: {
          background: '#1e1e1e',
          foreground: '#d4d4d4',
          cursor: '#d4d4d4',
        },
        scrollback: 10000,
        macOptionIsMeta: true,
        allowTransparency: true,
      })

      termRef.current = term

      const fitAddon = new FitAddon()
      fitAddonRef.current = fitAddon
      term.loadAddon(fitAddon)

      term.open(containerRef.current)
      setTimeout(() => {
        fitAddon.fit()
        term.focus()
      }, 50)

      // 使用 attachCustomKeyEventHandler 处理 Safari/WebView 键盘问题
      // 返回 false = 阻止 xterm 处理字符，返回 true = 让 xterm 处理
      let buffer = ''
      let timer: ReturnType<typeof setTimeout> | null = null

      const flush = () => {
        if (buffer && termRef.current) {
          console.log('flush:', JSON.stringify(buffer))
          termRef.current.write(buffer)
          buffer = ''
        }
        timer = null
      }

      term.attachCustomKeyEventHandler(e => {
        if (e.type === 'keydown') {
          // 控制字符：让 xterm 正常处理
          if (
            e.key === 'Enter' ||
            e.key === 'Tab' ||
            e.key.startsWith('Arrow') ||
            e.ctrlKey ||
            e.metaKey
          ) {
            return true
          }

          // 普通字符：缓冲 10ms 合并快速按键
          if (e.key.length === 1) {
            buffer += e.key
            if (timer) clearTimeout(timer)
            timer = setTimeout(flush, 10)
            return false // 阻止 xterm 默认处理，我们手动 flush
          }
        }
        return true
      })

      setIsReady(true)
      isMountedRef.current = true

      return () => {
        isMountedRef.current = false
        if (timer) clearTimeout(timer)
        term.dispose()
        termRef.current = null
        setIsReady(false)
      }
    }, [tabId, tab])

    // Handle resize
    useEffect(() => {
      if (!isReady) return

      const handleWindowResize = () => {
        fitAddonRef.current?.fit()
      }

      const resizeObserver = new ResizeObserver(() => {
        fitAddonRef.current?.fit()
      })

      if (containerRef.current) {
        resizeObserver.observe(containerRef.current)
      }

      window.addEventListener('resize', handleWindowResize)

      return () => {
        window.removeEventListener('resize', handleWindowResize)
        resizeObserver.disconnect()
      }
    }, [isReady])

    if (!tab) {
      return (
        <div className="h-full flex items-center justify-center bg-[#1e1e1e]">
          <div className="text-center">
            <p className="text-[#d4d4d4] mb-4">No active session</p>
            <p className="text-[#858585] text-sm">
              Select a host from the Hosts page to start a terminal session.
            </p>
          </div>
        </div>
      )
    }

    return (
      <div className="h-full flex bg-[#1e1e1e]">
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <div
            ref={containerRef}
            className="flex-1 overflow-hidden"
            tabIndex={0}
            style={{ WebkitUserSelect: 'text', userSelect: 'text' }}
          />
        </div>
      </div>
    )
  },
)

export default TerminalContainer
