import { ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { SearchResult } from './command-palette-types'
import { getTypeBadgeClass, getTypeLabel } from './command-palette-utils'

interface CommandPaletteResultProps {
  result: SearchResult
  index: number
  selected: boolean
  onSelect: (result: SearchResult) => void
  onHover: (index: number) => void
}

export function CommandPaletteResult({
  result,
  index,
  selected,
  onSelect,
  onHover,
}: CommandPaletteResultProps) {
  return (
    <Button
      variant="ghost"
      role="option"
      aria-selected={selected}
      data-palette-result-index={index}
      className={cn(
        'h-auto w-full justify-start gap-3 px-3 py-3',
        selected
          ? 'border border-primary/20 bg-primary/10'
          : 'hover:bg-muted/50',
      )}
      onClick={() => onSelect(result)}
      onMouseEnter={() => onHover(index)}
    >
      <span
        className={cn(
          'shrink-0',
          selected ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        {result.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className={cn('truncate font-medium', selected && 'text-primary')}>
          {result.title}
        </div>
        {result.description || result.hint ? (
          <div className="truncate text-xs text-muted-foreground">
            {result.description || result.hint}
          </div>
        ) : null}
      </div>
      <span
        className={cn(
          'shrink-0 rounded px-2 py-0.5 text-xs',
          getTypeBadgeClass(result.type),
        )}
      >
        {getTypeLabel(result.type)}
      </span>
      <ChevronRight
        className={cn(
          'size-4 shrink-0',
          selected ? 'text-primary' : 'text-muted-foreground',
        )}
      />
    </Button>
  )
}
