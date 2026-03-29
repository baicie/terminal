import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal as TerminalComponent } from '@xterm/xterm'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ViewContainer, ViewToolbar, ViewContent, ViewHeader } from '@/components/view-container'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ArrowLeft, Clipboard, Check } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import '@xterm/xterm/css/xterm.css'

interface XtermEvent {
  id: number
  type: 'onData' | 'onKey' | 'textarea_keydown' | 'textarea_input' | 'textarea_keyup'
  data: string
  key?: string
  code?: string
  keyCode?: number
  which?: number
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  domEvent?: string
  time: string
}

const xtermEvents: XtermEvent[] = []
let eventId = 0

const XtermTest: React.FC = () => {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const termRef = useRef<TerminalComponent | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  const [events, setEvents] = useState<XtermEvent[]>([])
  const [recording, setRecording] = useState(true)
  const [showRaw, setShowRaw] = useState(false)
  const [fontSize, setFontSize] = useState(14)
  const [autoScroll, setAutoScroll] = useState(true)
  const [copied, setCopied] = useState(false)

  const scrollToBottom = () => {
    const viewport = scrollRef.current?.closest('[data-slot="scroll-area"]')?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLDivElement | null
    if (viewport) {
      requestAnimationFrame(() => {
        viewport.scrollTop = viewport.scrollHeight
      })
    }
  }

  const addEvent = (evt: XtermEvent) => {
    if (!recording) return
    xtermEvents.push(evt)
    if (xtermEvents.length > 500) xtermEvents.shift()
    setEvents([...xtermEvents])
    if (autoScroll) scrollToBottom()
  }

  const formatEventLine = (evt: XtermEvent): string => {
    switch (evt.type) {
      case 'onData':
        return `[${evt.time}] onData data="${formatData(evt.data, evt.type)}"`
      case 'onKey':
        return `[${evt.time}] onKey key="${formatModKey(evt)}" which=${evt.which}`
      case 'textarea_keydown':
        return `[${evt.time}] textarea_keydown key="${formatModKey(evt)}" code="${evt.code}" which=${evt.which}`
      case 'textarea_input':
        return `[${evt.time}] textarea_input data="${formatData(evt.data, evt.type)}"`
      case 'textarea_keyup':
        return `[${evt.time}] textarea_keyup key="${evt.key}" which=${evt.which}`
    }
  }

  const handleCopyEvents = async () => {
    if (xtermEvents.length === 0) {
      toast.warning(t('experiments.noEvents'))
      return
    }
    const text = xtermEvents.map(formatEventLine).join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      toast.success(`${t('experiments.copied')} (${xtermEvents.length})`)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(t('experiments.copyFailed'))
    }
  }

  // Initialize xterm
  useEffect(() => {
    if (!containerRef.current) return

    const term = new TerminalComponent({
      cursorBlink: true,
      fontSize,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        cursorAccent: '#1e1e1e',
        selectionBackground: '#264f78',
        black: '#1e1e1e',
        red: '#f44747',
        green: '#608b4e',
        yellow: '#dcdcaa',
        blue: '#569cd6',
        magenta: '#c586c0',
        cyan: '#4ec9b0',
        white: '#d4d4d4',
        brightBlack: '#808080',
        brightRed: '#f44747',
        brightGreen: '#608b4e',
        brightYellow: '#dcdcaa',
        brightBlue: '#569cd6',
        brightMagenta: '#c586c0',
        brightCyan: '#4ec9b0',
        brightWhite: '#ffffff',
      },
      scrollback: 2000,
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

    term.open(containerRef.current)

    setTimeout(() => {
      fitAddon.fit()
      term.focus()
    }, 50)

    // Write a welcome message
    term.write('\r\n\x1b[1;32m[Xterm Test]\x1b[0m Terminal ready. Type something!\r\n\r\n$ ')

    // Access underlying textarea (xterm.js uses a hidden textarea for keyboard input)
    const textarea = containerRef.current.querySelector('textarea') as HTMLTextAreaElement | null
    textareaRef.current = textarea

    // --- xterm onData: fired for all input (keypress, mouse, paste, etc.) ---
    term.onData((data: string) => {
      addEvent({
        id: ++eventId,
        type: 'onData',
        data,
        time: new Date().toISOString().split('T')[1].replace('Z', ''),
      })
      // Echo typed characters locally
      if (data.length === 1 && data.charCodeAt(0) >= 32) {
        term.write(data)
      }
    })

    // --- xterm onKey: fired for keyboard key presses ---
    term.onKey(({ key, domEvent }) => {
      addEvent({
        id: ++eventId,
        type: 'onKey',
        data: key,
        key: domEvent.key,
        code: domEvent.code,
        keyCode: domEvent.keyCode,
        which: domEvent.which,
        ctrlKey: domEvent.ctrlKey,
        shiftKey: domEvent.shiftKey,
        altKey: domEvent.altKey,
        metaKey: domEvent.metaKey,
        time: new Date().toISOString().split('T')[1].replace('Z', ''),
      })
    })

    // --- Underlying textarea events (if accessible) ---
    if (textarea) {
      textarea.addEventListener('keydown', (e: KeyboardEvent) => {
        addEvent({
          id: ++eventId,
          type: 'textarea_keydown',
          data: '',
          key: e.key,
          code: e.code,
          keyCode: e.keyCode,
          which: e.which,
          ctrlKey: e.ctrlKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          metaKey: e.metaKey,
          domEvent: e.type,
          time: new Date().toISOString().split('T')[1].replace('Z', ''),
        })
      })
      textarea.addEventListener('input', (e: Event) => {
        addEvent({
          id: ++eventId,
          type: 'textarea_input',
          data: (e as InputEvent).data ?? '',
          time: new Date().toISOString().split('T')[1].replace('Z', ''),
        })
      })
      textarea.addEventListener('keyup', (e: KeyboardEvent) => {
        addEvent({
          id: ++eventId,
          type: 'textarea_keyup',
          data: '',
          key: e.key,
          code: e.code,
          keyCode: e.keyCode,
          which: e.which,
          time: new Date().toISOString().split('T')[1].replace('Z', ''),
        })
      })
    }

    // Resize observer — use rAF to debounce and avoid "ResizeObserver loop" errors
    let roRafId: number | null = null
    const ro = new ResizeObserver(() => {
      if (roRafId !== null) cancelAnimationFrame(roRafId)
      roRafId = requestAnimationFrame(() => {
        fitAddon.fit()
        roRafId = null
      })
    })
    if (containerRef.current) ro.observe(containerRef.current)

    return () => {
      if (roRafId !== null) cancelAnimationFrame(roRafId)
      ro.disconnect()
      term.dispose()
      termRef.current = null
      xtermEvents.length = 0
      setEvents([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Font size
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontSize = fontSize
      fitAddonRef.current?.fit()
    }
  }, [fontSize])

  const getEventColor = (type: XtermEvent['type']) => {
    switch (type) {
      case 'onData': return 'bg-green-500/10 text-green-600 border-green-500/20'
      case 'onKey': return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
      case 'textarea_keydown': return 'bg-purple-500/10 text-purple-600 border-purple-500/20'
      case 'textarea_input': return 'bg-orange-500/10 text-orange-600 border-orange-500/20'
      case 'textarea_keyup': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20'
    }
  }

  const formatData = (data: string, type: XtermEvent['type']) => {
    if (!data) return ''
    if (type === 'onData') {
      return data.split('').map(c => {
        const code = c.charCodeAt(0)
        if (code < 32) {
          const names: Record<number, string> = { 13: '\\r', 10: '\\n', 9: '\\t', 27: '\\e', 127: '\\b' }
          return names[code] ?? `\\x${code.toString(16).padStart(2, '0')}`
        }
        return c === ' ' ? '<sp>' : c
      }).join('')
    }
    return data
  }

  const formatModKey = (e: XtermEvent) => {
    const parts: string[] = []
    if (e.ctrlKey) parts.push('Ctrl')
    if (e.shiftKey) parts.push('Shift')
    if (e.altKey) parts.push('Alt')
    if (e.metaKey) parts.push('Meta')
    if (e.key) parts.push(e.key)
    return parts.join('+')
  }

  return (
    <ViewContainer>
      <ViewToolbar>
        <Link to="/experiments">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="size-4 mr-1" data-icon="inline-start" />
            {t('common.back')}
          </Button>
        </Link>
        <div className="flex-1" />
        {/* Font size controls */}
        <Button variant="outline" size="sm" onClick={() => setFontSize(f => Math.max(8, f - 1))}>
          A-
        </Button>
        <span className="text-xs text-muted-foreground w-8 text-center">{fontSize}</span>
        <Button variant="outline" size="sm" onClick={() => setFontSize(f => Math.min(32, f + 1))}>
          A+
        </Button>
        <Button
          variant={showRaw ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowRaw(v => !v)}
        >
          {showRaw ? t('experiments.hex') : t('experiments.named')}
        </Button>
        <Button
          variant={recording ? 'default' : 'outline'}
          size="sm"
          onClick={() => setRecording(v => !v)}
        >
          {recording ? t('experiments.recording') : t('experiments.paused')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            xtermEvents.length = 0
            setEvents([])
            scrollToBottom()
          }}
        >
          {t('common.clear')}
        </Button>
        <Button
          variant={autoScroll ? 'default' : 'outline'}
          size="sm"
          onClick={() => {
            setAutoScroll(v => !v)
            if (!autoScroll) scrollToBottom()
          }}
        >
          {t('experiments.auto')}{autoScroll ? ': ' + t('common.on') : ': ' + t('common.off')}
        </Button>
      </ViewToolbar>

      <ViewContent className="p-6">
        <ViewHeader
          title={t('experiments.xtermTitle')}
          description={t('experiments.xtermDesc')}
        />

        <div className="mt-4 flex flex-col lg:flex-row gap-4">
          {/* Left: Xterm */}
          <div className="flex-1 flex flex-col gap-2">
            <label className="text-sm font-medium text-muted-foreground">{t('experiments.xtermTerminal')}</label>
            <div
              ref={containerRef}
              className="flex-1 min-h-[300px] rounded-lg border overflow-hidden"
              style={{ background: '#1e1e1e' }}
            />
            <p className="text-xs text-muted-foreground">
              {t('experiments.xtermHint')}
            </p>
          </div>

          {/* Right: Event Log */}
          <div className="flex-1 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-muted-foreground">
                {t('experiments.eventLog')} ({events.length})
              </label>
              <div className="flex gap-2">
                <Badge variant="outline" className="text-[10px] bg-green-500/10 text-green-600">onData</Badge>
                <Badge variant="outline" className="text-[10px] bg-blue-500/10 text-blue-600">onKey</Badge>
                <Badge variant="outline" className="text-[10px] bg-purple-500/10 text-purple-600">textarea</Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2"
                  onClick={handleCopyEvents}
                  title={t('experiments.copyEvents')}
                >
                  {copied ? (
                    <Check className="size-3 text-green-500" data-icon="inline-start" />
                  ) : (
                    <Clipboard className="size-3" data-icon="inline-start" />
                  )}
                  {copied ? t('experiments.copied') : t('experiments.copy')}
                </Button>
              </div>
            </div>
            <div className="h-[400px]">
              <ScrollArea className="h-full rounded-lg border bg-muted/30">
                <div ref={scrollRef} className="p-3 space-y-1">
                {events.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {t('experiments.noEvents')}
                  </p>
                )}
                {events.slice().reverse().map(evt => (
                  <div key={evt.id} className="flex items-start gap-2 text-xs font-mono py-0.5">
                    <span className="text-muted-foreground shrink-0">{evt.time}</span>
                    <Badge
                      variant="outline"
                      className={`shrink-0 font-mono text-[10px] px-1 ${getEventColor(evt.type)}`}
                    >
                      {evt.type}
                    </Badge>
                    <span className="break-all text-muted-foreground">
                      {evt.type === 'onData' && `data="${formatData(evt.data, evt.type)}"`}
                      {evt.type === 'onKey' && `key="${formatModKey(evt)}" which=${evt.which}`}
                      {evt.type === 'textarea_keydown' && `key="${formatModKey(evt)}" code="${evt.code}" which=${evt.which}`}
                      {evt.type === 'textarea_input' && `data="${formatData(evt.data, evt.type)}"`}
                      {evt.type === 'textarea_keyup' && `key="${evt.key}" which=${evt.which}`}
                    </span>
                  </div>
                ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </div>

        <Separator className="my-6" />

        <div className="text-sm text-muted-foreground space-y-2">
          <p className="font-medium text-foreground">{t('experiments.eventExplanation')}</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Badge variant="outline" className="bg-green-500/10 text-green-600 text-xs">onData</Badge>
              <p className="text-xs">{t('experiments.onDataDesc')}</p>
            </div>
            <div className="space-y-1">
              <Badge variant="outline" className="bg-blue-500/10 text-blue-600 text-xs">onKey</Badge>
              <p className="text-xs">{t('experiments.onKeyDesc')}</p>
            </div>
            <div className="space-y-1">
              <Badge variant="outline" className="bg-purple-500/10 text-purple-600 text-xs">textarea_*</Badge>
              <p className="text-xs">{t('experiments.textareaEventDesc')}</p>
            </div>
          </div>
        </div>
      </ViewContent>
    </ViewContainer>
  )
}

export default XtermTest
