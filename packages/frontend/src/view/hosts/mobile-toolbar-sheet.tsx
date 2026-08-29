import {
  Server,
  Terminal,
  Usb,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'

interface MobileToolbarSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onNewHost: () => void
  onNewLocalTerminal: () => void
  onSerialConnect: () => void
}

export function MobileToolbarSheet({
  open,
  onOpenChange,
  onNewHost,
  onNewLocalTerminal,
  onSerialConnect,
}: MobileToolbarSheetProps) {
  const { t } = useTranslation()

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="pb-safe">
        <div className="flex flex-col gap-2 pt-2">
          <p className="text-sm font-medium text-muted-foreground px-1 mb-1">
            {t('hosts.newHost')}
          </p>
          <Button
            variant="outline"
            className="justify-start gap-3 h-12"
            onClick={() => {
              onOpenChange(false)
              onNewHost()
            }}
          >
            <Server className="size-5" />
            {t('hosts.sshHost')}
          </Button>
          <Button
            variant="outline"
            className="justify-start gap-3 h-12"
            onClick={() => {
              onOpenChange(false)
              onNewLocalTerminal()
            }}
          >
            <Terminal className="size-5" />
            {t('hosts.terminal')}
          </Button>
          <Button
            variant="outline"
            className="justify-start gap-3 h-12"
            onClick={() => {
              onOpenChange(false)
              onSerialConnect()
            }}
          >
            <Usb className="size-5" />
            {t('hosts.serial')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
