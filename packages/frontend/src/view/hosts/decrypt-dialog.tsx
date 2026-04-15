import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface DecryptDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  hostName: string
  password: string
  onPasswordChange: (password: string) => void
  onDecrypt: () => void
}

export const DecryptDialog: React.FC<DecryptDialogProps> = ({
  open,
  onOpenChange,
  hostName,
  password,
  onPasswordChange,
  onDecrypt,
}) => {
  const { t } = useTranslation()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="size-5" />
            {t('teams.enterDecryptPassword')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            {t('teams.decryptDesc', { host: hostName })}
          </p>

          <div className="space-y-2">
            <Label htmlFor="decrypt-password">
              {t('teams.decryptPassword')}
            </Label>
            <Input
              id="decrypt-password"
              type="password"
              value={password}
              onChange={e => onPasswordChange(e.target.value)}
              placeholder={t('teams.enterDecryptPassword')}
              onKeyDown={e => {
                if (e.key === 'Enter' && password) onDecrypt()
              }}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onDecrypt} disabled={!password}>
            {t('teams.decrypt')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
