import { useState } from 'react'
import {
  ViewContainer,
  ViewToolbar,
  ViewContent,
  ViewHeader,
} from '@/components/view-container'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Terminal, Trash2, Copy, Download } from 'lucide-react'

interface KeyEvent {
  type: string
  key: string
  code: string
  keyCode: number
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  timestamp: number
}

const KeyboardTestView: React.FC = () => {
  const [text, setText] = useState('')
  const [events, setEvents] = useState<KeyEvent[]>([])
  const [filterType, setFilterType] = useState<string>('')

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const event: KeyEvent = {
      type: 'keydown',
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      timestamp: Date.now(),
    }
    addEvent(event)
  }

  const handleKeyUp = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const event: KeyEvent = {
      type: 'keyup',
      key: e.key,
      code: e.code,
      keyCode: e.keyCode,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      timestamp: Date.now(),
    }
    addEvent(event)
  }

  const addEvent = (event: KeyEvent) => {
    setEvents(prev => [event, ...prev].slice(0, 100))
  }

  const clearEvents = () => {
    setEvents([])
  }

  const filteredEvents = filterType
    ? events.filter(e => e.type === filterType)
    : events

  const exportEvents = () => {
    const data = JSON.stringify(filteredEvents, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `key-events-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const copyEvents = () => {
    const data = JSON.stringify(filteredEvents, null, 2)
    navigator.clipboard.writeText(data)
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const hours = date.getHours().toString().padStart(2, '0')
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const seconds = date.getSeconds().toString().padStart(2, '0')
    const ms = date.getMilliseconds().toString().padStart(3, '0')
    return `${hours}:${minutes}:${seconds}.${ms}`
  }

  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <div className="flex items-center gap-2">
          <Terminal className="size-4" />
          <span className="text-sm font-medium">键盘事件测试</span>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-2">
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">全部事件</option>
            <option value="keydown">keydown</option>
            <option value="keyup">keyup</option>
            <option value="keypress">keypress</option>
          </select>
          <Button size="sm" variant="outline" onClick={copyEvents}>
            <Copy className="size-4 mr-1" data-icon="inline-start" />
            复制
          </Button>
          <Button size="sm" variant="outline" onClick={exportEvents}>
            <Download className="size-4 mr-1" data-icon="inline-start" />
            导出
          </Button>
          <Button size="sm" variant="destructive" onClick={clearEvents}>
            <Trash2 className="size-4 mr-1" data-icon="inline-start" />
            清空
          </Button>
        </div>
      </ViewToolbar>

      <ViewContent className="p-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 左侧：输入区域 */}
          <div className="space-y-4">
            <ViewHeader
              title="输入区域"
              description="在此处输入内容，监听键盘事件"
            />
            <div className="space-y-2">
              <Label htmlFor="text-input">文本输入</Label>
              <Textarea
                id="text-input"
                value={text}
                onChange={e => setText(e.target.value)}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                placeholder="在这里输入内容..."
                className="min-h-[200px] font-mono text-sm"
              />
            </div>
            <div className="text-sm text-muted-foreground">
              当前字符数: {text.length} | 事件数: {events.length}
            </div>
          </div>

          {/* 右侧：事件日志 */}
          <div className="space-y-4">
            <ViewHeader title="事件日志" description="实时显示键盘事件" />
            <div className="rounded-md border bg-muted/50">
              <div className="max-h-[400px] overflow-auto">
                {filteredEvents.length === 0 ? (
                  <div className="p-4 text-center text-muted-foreground">
                    暂无事件，请在上方输入框中输入内容
                  </div>
                ) : (
                  <div className="divide-y">
                    {filteredEvents.map((event, index) => (
                      <div
                        key={`${event.timestamp}-${index}`}
                        className="p-3 text-sm font-mono hover:bg-muted/80 transition-colors"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className={`px-2 py-0.5 rounded text-xs font-medium ${
                              event.type === 'keydown'
                                ? 'bg-blue-100 text-blue-700'
                                : event.type === 'keyup'
                                  ? 'bg-green-100 text-green-700'
                                  : 'bg-yellow-100 text-yellow-700'
                            }`}
                          >
                            {event.type}
                          </span>
                          <span className="text-muted-foreground">
                            {formatTime(event.timestamp)}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                          <div>
                            <span className="text-muted-foreground">key:</span>{' '}
                            <span className="font-medium">"{event.key}"</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">code:</span>{' '}
                            {event.code}
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              keyCode:
                            </span>{' '}
                            {event.keyCode}
                          </div>
                          <div>
                            <span className="text-muted-foreground">
                              modifiers:
                            </span>{' '}
                            {[
                              event.ctrlKey && 'Ctrl',
                              event.shiftKey && 'Shift',
                              event.altKey && 'Alt',
                              event.metaKey && 'Meta',
                            ]
                              .filter(Boolean)
                              .join('+') || 'none'}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 常用按键说明 */}
        <div className="mt-6">
          <ViewHeader
            title="常用按键参考"
            description="常见特殊键的 key 和 code 值"
          />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            {[
              { key: 'Enter', code: 'Enter' },
              { key: 'Tab', code: 'Tab' },
              { key: 'Escape', code: 'Escape' },
              { key: 'Backspace', code: 'Backspace' },
              { key: 'Delete', code: 'Delete' },
              { key: 'ArrowUp', code: 'ArrowUp' },
              { key: 'ArrowDown', code: 'ArrowDown' },
              { key: 'ArrowLeft', code: 'ArrowLeft' },
              { key: 'ArrowRight', code: 'ArrowRight' },
              { key: 'Space', code: 'Space' },
              { key: 'Home', code: 'Home' },
              { key: 'End', code: 'End' },
            ].map(item => (
              <div
                key={item.code}
                className="p-3 rounded-lg border bg-card text-sm"
              >
                <div className="font-medium">{item.key}</div>
                <div className="text-xs text-muted-foreground font-mono">
                  {item.code}
                </div>
              </div>
            ))}
          </div>
        </div>
      </ViewContent>
    </ViewContainer>
  )
}

export default KeyboardTestView
