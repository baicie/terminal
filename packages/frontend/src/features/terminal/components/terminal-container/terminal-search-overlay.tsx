import type { SearchAddon } from '@xterm/addon-search'
import {
  CaseSensitive,
  ChevronDown,
  ChevronUp,
  Regex,
  Type,
  X,
} from 'lucide-react'
import { useId, type ReactNode } from 'react'
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
  const errorId = `terminal-search-error-${useId().replaceAll(':', '')}`

  if (!open) return null

  return (
    <div
      className={cn(
        'absolute inset-x-2 top-2 z-20 flex flex-col items-stretch gap-1 rounded-md sm:left-auto sm:flex-row sm:items-center',
        'border border-border/60 bg-popover/95 p-1.5 text-popover-foreground',
        'shadow-lg backdrop-blur-sm',
      )}
      onMouseDown={event => event.stopPropagation()}
    >
      <div className="flex min-w-0 items-center gap-1">
        <Input
          ref={search.inputRef}
          value={search.query}
          onChange={event => search.setQuery(event.target.value)}
          onKeyDown={search.handleKeyDown}
          placeholder={t('terminal.searchPlaceholder')}
          aria-label={t('terminal.searchPlaceholder')}
          aria-invalid={Boolean(search.regexError)}
          aria-describedby={search.regexError ? errorId : undefined}
          className={cn(
            'h-11 min-w-0 flex-1 text-base sm:h-7 sm:w-56 sm:flex-none sm:text-sm',
            search.regexError && 'ring-1 ring-destructive/50',
          )}
        />
        {search.matchLabel ? (
          <span className="min-w-14 text-center text-xs tabular-nums text-muted-foreground">
            {search.matchLabel}
          </span>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 sm:justify-start">
        <div className="flex items-center gap-2 sm:gap-0.5">
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
        <div className="flex items-center gap-2 sm:gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="size-11 sm:size-7"
            onClick={search.handlePrevious}
            disabled={!search.query}
            aria-label={t('terminal.searchPrev')}
            title={`${t('terminal.searchPrev')} (Shift+Enter / Shift+F3)`}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 sm:size-7"
            onClick={search.handleNext}
            disabled={!search.query}
            aria-label={t('terminal.searchNext')}
            title={`${t('terminal.searchNext')} (Enter / F3)`}
          >
            <ChevronDown />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-11 sm:size-7"
            onClick={onClose}
            aria-label={t('common.close')}
            title={`${t('common.close')} (Esc)`}
          >
            <X />
          </Button>
        </div>
      </div>

      {search.regexError && (
        <div
          id={errorId}
          role="alert"
          aria-live="polite"
          className="absolute top-full left-0 z-30 mt-1 w-64 rounded bg-destructive/95 px-2 py-1 text-xs text-destructive-foreground shadow-md"
        >
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
      aria-label={title}
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        'size-11 text-muted-foreground transition-colors hover:text-foreground sm:size-7',
        pressed && 'bg-accent text-foreground',
      )}
    >
      {children}
    </Button>
  )
}

export default TerminalSearchOverlay
