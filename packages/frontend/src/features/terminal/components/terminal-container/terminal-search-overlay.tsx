import type { SearchAddon } from '@xterm/addon-search'
import {
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Regex,
  Type,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useTerminalSearch } from './use-terminal-search'

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
  const search = useTerminalSearch({ open, onClose, searchAddon })

  if (!open) return null

  return (
    <div
      className={cn(
        'absolute top-2 right-2 z-20 flex items-center gap-1 rounded-md',
        'border border-border/60 bg-popover/95 p-1.5 text-popover-foreground',
        'shadow-lg backdrop-blur-sm',
      )}
      onMouseDown={event => event.stopPropagation()}
    >
      <Input
        ref={search.inputRef}
        value={search.query}
        onChange={event => search.setQuery(event.target.value)}
        onKeyDown={search.handleKeyDown}
        placeholder={t('terminal.searchPlaceholder')}
        aria-label={t('terminal.searchPlaceholder')}
        className={cn(
          'h-7 w-56 text-sm',
          search.regexError && 'ring-1 ring-red-500/50',
        )}
      />

      {search.matchLabel && (
        <span className="min-w-[3.5rem] text-center text-xs tabular-nums text-muted-foreground">
          {search.matchLabel}
        </span>
      )}

      <div className="flex items-center gap-0.5">
        <SearchToggle
          pressed={search.caseSensitive}
          onPressedChange={search.setCaseSensitive}
          title={t('terminal.searchCaseSensitive')}
        >
          <CaseSensitive />
        </SearchToggle>
        <SearchToggle
          pressed={search.wholeWord}
          onPressedChange={search.setWholeWord}
          title={t('terminal.searchWholeWord')}
        >
          <Type />
        </SearchToggle>
        <SearchToggle
          pressed={search.regex}
          onPressedChange={search.setRegex}
          title={t('terminal.searchRegex')}
        >
          <Regex />
        </SearchToggle>
      </div>

      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={search.handlePrevious}
          disabled={!search.query}
          title={`${t('terminal.searchPrev')} (Shift+Enter / Shift+F3)`}
        >
          <ChevronUp />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={search.handleNext}
          disabled={!search.query}
          title={`${t('terminal.searchNext')} (Enter / F3)`}
        >
          <ChevronDown />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          onClick={onClose}
          title={`${t('common.close')} (Esc)`}
        >
          <X />
        </Button>
      </div>

      {search.regexError && (
        <div className="absolute top-full left-0 z-30 mt-1 w-64 rounded bg-destructive/95 px-2 py-1 text-xs text-destructive-foreground shadow-md">
          {search.regexError}
        </div>
      )}
    </div>
  )
}

function SearchToggle({
  pressed,
  onPressedChange,
  title,
  children,
}: {
  pressed: boolean
  onPressedChange: (next: boolean) => void
  title: string
  children: ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      title={title}
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'size-7 text-muted-foreground transition-colors hover:text-foreground',
        pressed && 'bg-accent text-foreground',
      )}
    >
      {children}
    </Button>
  )
}

export default TerminalSearchOverlay
