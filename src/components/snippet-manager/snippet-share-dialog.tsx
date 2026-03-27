import type { SnippetRecord } from '@/service/database'
import { Share2, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface SnippetShareDialogProps {
  open: boolean
  onClose: () => void
  snippet: SnippetRecord | null
  permission: 'readonly' | 'readwrite'
  onPermissionChange: (permission: 'readonly' | 'readwrite') => void
  teamName?: string
  onShare: () => void
}

export const SnippetShareDialog: React.FC<SnippetShareDialogProps> = ({
  open,
  onClose,
  snippet,
  permission,
  onPermissionChange,
  teamName,
  onShare,
}) => {
  const { t } = useTranslation()

  if (!snippet) return null

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('teams.shareSnippet')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="p-3 bg-muted rounded-lg">
            <div className="font-medium">{snippet.name}</div>
            {snippet.description && (
              <div className="text-sm text-muted-foreground mt-1">
                {snippet.description}
              </div>
            )}
            <pre className="text-xs bg-background p-2 rounded mt-2 overflow-x-auto max-h-16">
              {snippet.script.substring(0, 100)}
              {snippet.script.length > 100 && '...'}
            </pre>
          </div>

          <div className="space-y-2">
            <Label>{t('teams.permissions')}</Label>
            <Select
              value={permission}
              onValueChange={v =>
                onPermissionChange(v as 'readonly' | 'readwrite')
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="readonly">
                  <div className="flex items-center gap-2">
                    <span>{t('teams.readonly')}</span>
                    <span className="text-xs text-muted-foreground">
                      - {t('teams.readonlyDesc')}
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="readwrite">
                  <div className="flex items-center gap-2">
                    <span>{t('teams.readwrite')}</span>
                    <span className="text-xs text-muted-foreground">
                      - {t('teams.readwriteDesc')}
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="p-3 bg-secondary/50 rounded-lg text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Users className="size-4" />
              <span>
                {t('teams.shareToTeam', { team: teamName })}
              </span>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onShare}>
            <Share2 className="size-4 mr-2" />
            {t('teams.share')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
