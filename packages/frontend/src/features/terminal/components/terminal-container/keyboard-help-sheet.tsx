import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { KEYBOARD_SHORTCUTS } from './keyboard-bar-data'

interface KeyboardHelpSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onClear: () => void
}

export function KeyboardHelpSheet({
  open,
  onOpenChange,
  onClear,
}: KeyboardHelpSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[50dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex flex-col gap-3 pt-2">
          <p className="px-2 text-sm font-semibold text-muted-foreground">
            Keyboard Shortcuts
          </p>
          <div className="grid grid-cols-2 gap-2 px-2">
            {KEYBOARD_SHORTCUTS.map(([key, description]) => (
              <div
                key={key}
                className="flex items-center gap-2 py-2 border-b border-border/40"
              >
                <kbd className="min-w-[48px] px-1.5 py-0.5 text-xs font-mono bg-secondary rounded text-center">
                  {key}
                </kbd>
                <span className="text-xs text-muted-foreground">
                  {description}
                </span>
              </div>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="mx-2 mt-1"
            onClick={onClear}
          >
            <RotateCcw data-icon="inline-start" />
            Clear terminal
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
