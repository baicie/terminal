import type { TerminalThemePreset } from '@/service/database'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { TerminalThemePreview } from './terminal-theme-preview'

interface TerminalThemeGridProps {
  themes: readonly TerminalThemePreset[]
  selected: TerminalThemePreset
  title: string
  icon: LucideIcon
  onSelect: (theme: TerminalThemePreset) => void
}

function getThemeName(id: string) {
  return id
    .split('-')
    .map(word => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

export function TerminalThemeGrid({
  themes,
  selected,
  title,
  icon: Icon,
  onSelect,
}: TerminalThemeGridProps) {
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon />
        {title}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-5">
        {themes.map(theme => (
          <Tooltip key={theme}>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                aria-pressed={selected === theme}
                className={cn(
                  'h-auto flex-col gap-1.5 border-2 p-2',
                  selected === theme
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50',
                )}
                onClick={() => onSelect(theme)}
              >
                <TerminalThemePreview themeId={theme} />
                <span className="text-[10px] leading-tight font-medium">
                  {getThemeName(theme)}
                </span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="font-medium">{getThemeName(theme)}</p>
              <p className="text-xs text-muted-foreground/80">Click to apply</p>
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
