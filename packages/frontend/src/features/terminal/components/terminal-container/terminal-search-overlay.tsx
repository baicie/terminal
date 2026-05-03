/**
 * Terminal Search Overlay
 *
 * 终端内查找面板，复用 xterm 的 SearchAddon。
 *
 * 触发：Cmd/Ctrl + F（在 container 层捕获，阻止 xterm 接收）
 * 关闭：Esc 或点击 ×
 *
 * UI 与 VSCode 内置查找一致：右上角浮层、Enter 下一个、
 * Shift+Enter 上一个、支持大小写/全字/正则切换。
 * 增强：匹配计数 (n / total)、F3/Shift+F3 导航、正则错误提示。
 */

import type { SearchAddon, ISearchOptions, ISearchResultChangeEvent } from '@xterm/addon-search'
import {
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Regex,
  Type,
  X,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface TerminalSearchOverlayProps {
  open: boolean
  onClose: () => void
  searchAddon: SearchAddon | null
}

export function TerminalSearchOverlay({
  open,
  onClose,
  searchAddon,
}: TerminalSearchOverlayProps) {
  const { t } = useTranslation()
  const inputRef = React.useRef<HTMLInputElement>(null)

  const [query, setQuery] = React.useState('')
  const [caseSensitive, setCaseSensitive] = React.useState(false)
  const [wholeWord, setWholeWord] = React.useState(false)
  const [regex, setRegex] = React.useState(false)

  // Match count state (from onDidChangeResults)
  const [matchInfo, setMatchInfo] = React.useState({ index: -1, count: 0 })

  // Regex error feedback
  const [regexError, setRegexError] = React.useState<string | null>(null)

  // Build search options
  const buildOpts = React.useCallback(
    (): ISearchOptions => ({
      caseSensitive,
      wholeWord,
      regex,
      // Decorations 必须开启才能让 onDidChangeResults 正常工作
      decorations: {
        matchBackground: '#515c6a',
        matchBorder: '#888',
        matchOverviewRuler: '#d18616',
        activeMatchBackground: '#a8ac94',
        activeMatchBorder: '#fbf6cc',
        activeMatchColorOverviewRuler: '#d18616',
      },
    }),
    [caseSensitive, wholeWord, regex],
  )

  const performSearch = React.useCallback(
    (direction: 'next' | 'prev') => {
      if (!searchAddon || !query) return
      try {
        if (direction === 'next') {
          searchAddon.findNext(query, buildOpts())
        } else {
          searchAddon.findPrevious(query, buildOpts())
        }
        setRegexError(null)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (regex) setRegexError(msg)
      }
    },
    [searchAddon, query, buildOpts, regex],
  )

  const handleNext = React.useCallback(() => performSearch('next'), [performSearch])
  const handlePrev = React.useCallback(() => performSearch('prev'), [performSearch])

  // Listen for result count changes from SearchAddon
  React.useEffect(() => {
    if (!searchAddon || !open) return

    const handler = (event: ISearchResultChangeEvent) => {
      // Guard against updates after panel has closed
      setMatchInfo({ index: event.resultIndex, count: event.resultCount })
    }
    const disposable = searchAddon.onDidChangeResults(handler)
    return () => disposable.dispose()
  }, [searchAddon, open])

  // Reset state when panel closes
  React.useEffect(() => {
    if (!open) {
      setMatchInfo({ index: -1, count: 0 })
      setRegexError(null)
      setQuery('')
    }
  }, [open])

  // F3 / Shift+F3 document-level handler (works even when input is focused)
  React.useEffect(() => {
    if (!open) return

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'F3') {
        e.preventDefault()
        e.stopPropagation()
        if (e.shiftKey) {
          handlePrev()
        } else {
          handleNext()
        }
      }
    }

    document.addEventListener('keydown', handler, true)
    return () => document.removeEventListener('keydown', handler, true)
  }, [open, handleNext, handlePrev])

  // 打开时聚焦输入框并选中已有内容方便覆盖输入
  React.useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [open])

  // 输入或选项变化时高亮所有匹配
  React.useEffect(() => {
    if (!searchAddon || !open) return
    if (!query) {
      setMatchInfo({ index: -1, count: 0 })
      setRegexError(null)
      try {
        searchAddon.findNext('', buildOpts())
      } catch {
        /* ignore */
      }
      return
    }
    try {
      searchAddon.findNext(query, buildOpts())
      setRegexError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (regex) setRegexError(msg)
    }
  }, [query, buildOpts, searchAddon, open, regex])

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
        return
      }
      // Enter: next match; Shift+Enter: previous match
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) {
          handlePrev()
        } else {
          handleNext()
        }
        return
      }
    },
    [onClose, handleNext, handlePrev],
  )

  const hasMatches = matchInfo.count > 0
  const matchLabel =
    hasMatches ? `${matchInfo.index >= 0 ? matchInfo.index + 1 : 0} / ${matchInfo.count}` : null

  if (!open) return null

  return (
    <div
      className={cn(
        'absolute top-2 right-2 z-20',
        'flex items-center gap-1 rounded-md border border-border/60',
        'bg-popover/95 text-popover-foreground shadow-lg backdrop-blur-sm',
        'p-1.5',
      )}
      // 阻止 mousedown 冒泡：避免点击浮层时 xterm 抢回焦点
      onMouseDown={e => e.stopPropagation()}
    >
      <Input
        ref={inputRef}
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t('terminal.searchPlaceholder')}
        aria-label={t('terminal.searchPlaceholder')}
        className={cn(
          'h-7 w-56 text-sm',
          regexError && 'ring-1 ring-red-500/50',
        )}
      />

      {/* Match count badge */}
      {matchLabel && (
        <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-muted-foreground">
          {matchLabel}
        </span>
      )}

      <div className="flex items-center gap-0.5">
        <Toggle
          pressed={caseSensitive}
          onPressedChange={setCaseSensitive}
          title={t('terminal.searchCaseSensitive')}
        >
          <CaseSensitive className="size-3.5" />
        </Toggle>
        <Toggle
          pressed={wholeWord}
          onPressedChange={setWholeWord}
          title={t('terminal.searchWholeWord')}
        >
          <Type className="size-3.5" />
        </Toggle>
        <Toggle
          pressed={regex}
          onPressedChange={setRegex}
          title={t('terminal.searchRegex')}
        >
          <Regex className="size-3.5" />
        </Toggle>
      </div>

      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handlePrev}
          disabled={!query}
          title={`${t('terminal.searchPrev')} (Shift+Enter / Shift+F3)`}
        >
          <ChevronUp className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={handleNext}
          disabled={!query}
          title={`${t('terminal.searchNext')} (Enter / F3)`}
        >
          <ChevronDown className="size-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onClose}
          title={`${t('common.close')} (Esc)`}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Regex error tooltip */}
      {regexError && (
        <div
          className={cn(
            'absolute top-full left-0 mt-1 z-30',
            'w-64 rounded bg-destructive/95 text-destructive-foreground',
            'px-2 py-1 text-xs shadow-md',
          )}
        >
          {regexError}
        </div>
      )}
    </div>
  )
}

function Toggle({
  pressed,
  onPressedChange,
  title,
  children,
}: {
  pressed: boolean
  onPressedChange: (next: boolean) => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'inline-flex items-center justify-center size-7 rounded',
        'text-muted-foreground hover:text-foreground hover:bg-accent',
        'transition-colors',
        pressed && 'bg-accent text-foreground',
      )}
    >
      {children}
    </button>
  )
}

export default TerminalSearchOverlay
