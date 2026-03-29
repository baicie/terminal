import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ViewContainer, ViewToolbar, ViewContent, ViewHeader } from '@/components/view-container'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

interface InputEvent {
  id: number
  type: string
  data: string
  key?: string
  code?: string
  keyCode?: number
  which?: number
  ctrlKey?: boolean
  shiftKey?: boolean
  altKey?: boolean
  metaKey?: boolean
  inputType?: string
  time: string
}

const textareaTestEvents: InputEvent[] = []

let eventId = 0

const TextareaTest: React.FC = () => {
  const { t } = useTranslation()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [events, setEvents] = useState<InputEvent[]>([])
  const [recording, setRecording] = useState(true)
  const [showControlChars, setShowControlChars] = useState(false)
  const [autoScroll, setAutoScroll] = useState(true)

  const scrollToBottom = () => {
    const viewport = scrollRef.current?.closest('[data-slot="scroll-area"]')?.querySelector('[data-slot="scroll-area-viewport"]') as HTMLDivElement | null
    if (viewport) {
      requestAnimationFrame(() => {
        viewport.scrollTop = viewport.scrollHeight
      })
    }
  }

  const addEvent = useCallback((event: InputEvent) => {
    if (!recording) return
    textareaTestEvents.push(event)
    if (textareaTestEvents.length > 200) textareaTestEvents.shift()
    setEvents([...textareaTestEvents])
    if (autoScroll) scrollToBottom()
  }, [recording, autoScroll])

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    const handleInput = (e: InputEvent) => {
      addEvent({
        id: ++eventId,
        type: 'input',
        data: (e as InputEvent).data ?? '',
        inputType: (e as InputEvent).inputType ?? '',
        time: new Date().toISOString().split('T')[1].replace('Z', ''),
      })
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      addEvent({
        id: ++eventId,
        type: 'keydown',
        data: '',
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        which: e.which,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
        time: new Date().toISOString().split('T')[1].replace('Z', ''),
      })
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      addEvent({
        id: ++eventId,
        type: 'keyup',
        data: '',
        key: e.key,
        code: e.code,
        keyCode: e.keyCode,
        which: e.which,
        time: new Date().toISOString().split('T')[1].replace('Z', ''),
      })
    }

    textarea.addEventListener('input', handleInput)
    textarea.addEventListener('keydown', handleKeyDown)
    textarea.addEventListener('keyup', handleKeyUp)

    return () => {
      textarea.removeEventListener('input', handleInput)
      textarea.removeEventListener('keydown', handleKeyDown)
      textarea.removeEventListener('keyup', handleKeyUp)
    }
  }, [addEvent])

  const formatChar = (s: string) => {
    if (!s) return '<empty>'
    if (showControlChars) {
      return s.split('').map(c => {
        const code = c.charCodeAt(0)
        if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
          return `\\x${code.toString(16).padStart(2, '0')}`
        }
        return c === ' ' ? '<sp>' : c
      }).join('')
    }
    return s === ' ' ? '<sp>' : s
  }

  const formatKey = (e: InputEvent) => {
    const parts: string[] = []
    if (e.ctrlKey) parts.push('Ctrl')
    if (e.shiftKey) parts.push('Shift')
    if (e.altKey) parts.push('Alt')
    if (e.metaKey) parts.push('Meta')
    parts.push(e.key ?? '')
    return parts.join('+')
  }

  const getEventColor = (type: string) => {
    switch (type) {
      case 'input': return 'bg-green-500/10 text-green-600 border-green-500/20'
      case 'keydown': return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
      case 'keyup': return 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20'
      default: return ''
    }
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
        <Button
          variant={showControlChars ? 'secondary' : 'outline'}
          size="sm"
          onClick={() => setShowControlChars(v => !v)}
        >
          {showControlChars ? t('experiments.hide') : t('experiments.show')} {t('experiments.controlChars')}
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
            textareaTestEvents.length = 0
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
          title={t('experiments.textareaTitle')}
          description={t('experiments.textareaDesc')}
        />

        <div className="mt-4 flex flex-col lg:flex-row gap-4">
          {/* Left: Textarea */}
          <div className="flex-1 flex flex-col gap-2">
            <label className="text-sm font-medium text-muted-foreground">{t('experiments.textarea')}</label>
            <textarea
              ref={textareaRef}
              className="flex-1 min-h-[300px] p-4 rounded-lg border bg-background font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
              placeholder={t('experiments.textareaPlaceholder')}
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              {t('experiments.textareaHint')}
            </p>
          </div>

          {/* Right: Event Log */}
          <div className="flex-1 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-muted-foreground">
                {t('experiments.eventLog')} ({events.length})
              </label>
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
                    <span className="shrink-0 text-muted-foreground">
                      {evt.type === 'input'
                        ? `inputType="${evt.inputType ?? ''}" data="${formatChar(evt.data)}"`
                        : `key="${formatKey(evt)}" which=${evt.which}`}
                    </span>
                  </div>
                ))}
              </div>
            </ScrollArea>
            </div>
          </div>
        </div>

        <Separator className="my-6" />

        <div className="text-sm text-muted-foreground space-y-1">
          <p className="font-medium text-foreground">{t('experiments.testDesc')}</p>
          <ul className="list-disc list-inside space-y-0.5">
            <li><code className="text-xs bg-muted px-1 rounded">input</code> {t('experiments.eventDesc1')}</li>
            <li><code className="text-xs bg-muted px-1 rounded">keydown</code> / <code className="text-xs bg-muted px-1 rounded">keyup</code> {t('experiments.eventDesc2')}</li>
            <li>{t('experiments.eventDesc3')}</li>
          </ul>
        </div>
      </ViewContent>
    </ViewContainer>
  )
}

export default TextareaTest
