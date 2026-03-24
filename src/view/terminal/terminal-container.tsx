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

      // macOS Safari/WebView 兼容性处理
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.target !== term.element) return
        e.preventDefault()
        e.stopPropagation()
        // Safari 可能需要手动将事件传递给 xterm
        if (term.element) {
          term.focus()
        }
      }

      const handleKeyUp = (e: KeyboardEvent) => {
        if (e.target !== term.element) return
        e.preventDefault()
        e.stopPropagation()
      }

      // 只保留输入监听和打印
      term.onData(data => {
        console.log('keydown data:', data)
        console.log('key:', data)
        console.log('charCode:', data.charCodeAt(0))
      })

      // Safari/WebView 兼容：确保容器接收键盘事件
      containerRef.current?.addEventListener('keydown', handleKeyDown, true)
      containerRef.current?.addEventListener('keyup', handleKeyUp, true)
      containerRef.current?.addEventListener('keypress', handleKeyDown, true)

      setIsReady(true)
      isMountedRef.current = true

      return () => {
        isMountedRef.current = false
        containerRef.current?.removeEventListener('keydown', handleKeyDown, true)
        containerRef.current?.removeEventListener('keyup', handleKeyUp, true)
        containerRef.current?.removeEventListener('keypress', handleKeyDown, true)
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
            onKeyDown={e => {
              if (e.target === containerRef.current) {
                e.preventDefault()
              }
            }}
          />
        </div>
      </div>
    )
  },
)

export default TerminalContainer
