import type * as React from 'react'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export function TerminalPaneHeaderButton({
  label,
  active,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; active?: boolean }) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <Button
          {...props}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn(
            'size-7 text-muted-foreground hover:text-foreground',
            active && 'bg-secondary text-foreground',
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
