import { Eraser } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
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
  const { t } = useTranslation()
  const handleClear = () => {
    onClear()
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[70dvh] pb-[env(safe-area-inset-bottom)]"
      >
        <SheetHeader className="pb-0">
          <SheetTitle>{t('shortcuts.title')}</SheetTitle>
          <SheetDescription>
            {t('terminal.keyboardHelpDescription')}
          </SheetDescription>
        </SheetHeader>
        <div className="grid min-h-0 grid-cols-1 overflow-y-auto px-4 sm:grid-cols-2 sm:gap-x-4">
          {KEYBOARD_SHORTCUTS.map(shortcut => (
            <div key={shortcut.key} className="flex flex-col">
              <div className="flex min-h-11 items-center gap-2 py-2">
                <kbd className="min-w-12 rounded bg-secondary px-1.5 py-0.5 text-center font-mono text-xs">
                  {shortcut.key}
                </kbd>
                <span className="text-xs text-muted-foreground">
                  {t(shortcut.descriptionKey)}
                </span>
              </div>
              <Separator />
            </div>
          ))}
        </div>
        <SheetFooter className="pt-0">
          <Button type="button" variant="outline" onClick={handleClear}>
            <Eraser data-icon="inline-start" />
            {t('terminal.clearScreen')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
