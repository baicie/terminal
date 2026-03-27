import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
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
import { useTeamStore } from '@/store/team'

interface UserProfileDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const UserProfileDialog: React.FC<UserProfileDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation()
  const userProfile = useTeamStore(state => state.userProfile)
  const updateUserProfile = useTeamStore(state => state.updateUserProfile)
  const [name, setName] = useState(userProfile?.name || '')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (userProfile) {
      setName(userProfile.name)
    }
  }, [userProfile])

  const handleSave = async () => {
    setLoading(true)
    try {
      if (userProfile?.id) {
        await updateUserProfile(userProfile.id, { name })
        toast.success(t('common.success'))
        onOpenChange(false)
      }
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t('teams.myProfile')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">{t('common.name')}</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          <div className="text-xs text-muted-foreground space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/70">ID:</span>
              <code className="text-[10px] bg-muted px-1.5 py-0.5 rounded">
                {userProfile?.id || '—'}
              </code>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={loading || !name.trim()}>
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
