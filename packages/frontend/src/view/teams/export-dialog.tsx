import { Download, RefreshCw } from 'lucide-react'
import { useState } from 'react'
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
import { exportTeamPackage } from '@/service/sync'

interface ExportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  teamId: string
  teamName: string
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  open,
  onOpenChange,
  teamId,
  teamName,
}) => {
  const { t } = useTranslation()
  const [includeHosts, setIncludeHosts] = useState(true)
  const [includeSnippets, setIncludeSnippets] = useState(true)
  const [includeMembers, setIncludeMembers] = useState(false)
  const [loading, setLoading] = useState(false)

  const handleExport = async () => {
    setLoading(true)
    try {
      const filePath = await exportTeamPackage({
        teamId,
        teamName,
        includeHosts,
        includeSnippets,
        includeMembers,
      })
      if (filePath) {
        toast.success(t('teams.exportSuccess'), {
          description: filePath,
        })
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
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{t('teams.exportTeamPackage')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">
            {t('teams.exportTeamDesc')}
          </p>

          <div className="space-y-3">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeHosts}
                onChange={e => setIncludeHosts(e.target.checked)}
                className="size-4"
              />
              <div>
                <div className="text-sm font-medium">
                  {t('teams.includeHosts')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('teams.includeHostsDesc')}
                </div>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeSnippets}
                onChange={e => setIncludeSnippets(e.target.checked)}
                className="size-4"
              />
              <div>
                <div className="text-sm font-medium">
                  {t('teams.includeSnippets')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('teams.includeSnippetsDesc')}
                </div>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={includeMembers}
                onChange={e => setIncludeMembers(e.target.checked)}
                className="size-4"
              />
              <div>
                <div className="text-sm font-medium">
                  {t('teams.includeMembers')}
                </div>
                <div className="text-xs text-muted-foreground">
                  {t('teams.includeMembersDesc')}
                </div>
              </div>
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleExport}
            disabled={loading || (!includeHosts && !includeSnippets)}
          >
            {loading ? (
              <RefreshCw className="size-4 mr-2 animate-spin" />
            ) : (
              <Download className="size-4 mr-2" />
            )}
            {t('teams.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
