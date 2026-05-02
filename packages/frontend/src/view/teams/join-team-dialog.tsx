import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { Download, Package, RefreshCw, Upload } from 'lucide-react'
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
import { importTeamPackage, previewTeamPackage } from '@/service/sync'
import { useTeamStore } from '@/store/team'

interface JoinTeamDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export const JoinTeamDialog: React.FC<JoinTeamDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useTranslation()
  const [step, setStep] = useState<'select' | 'preview' | 'importing'>('select')
  const [previewData, setPreviewData] = useState<{
    teamName: string
    hosts: number
    groups: number
    snippets: number
    members: number
  } | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const enableTeamMode = useTeamStore(state => state.enableTeamMode)

  useEffect(() => {
    if (!open) {
      setStep('select')
      setPreviewData(null)
      setContent(null)
      setError(null)
      setLoading(false)
    }
  }, [open])

  const handleSelectFile = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          { name: 'Team Package', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })

      if (selected) {
        const fileContent = await readTextFile(selected)
        const preview = previewTeamPackage(fileContent)

        if (preview) {
          setContent(fileContent)
          setPreviewData({
            teamName: preview.teamName,
            hosts: preview.hosts?.length || 0,
            groups: preview.groups?.length || 0,
            snippets: preview.snippets?.length || 0,
            members: preview.members?.length || 0,
          })
          setStep('preview')
        } else {
          setError(t('teams.invalidPackageFormat'))
        }
      }
    } catch (err) {
      setError(String(err))
    }
  }

  const handleImport = async () => {
    if (!content) return

    setStep('importing')
    setLoading(true)
    try {
      const stats = await importTeamPackage(content, 'merge')
      await enableTeamMode({ mode: 'local' })
      toast.success(t('teams.importSuccess'), {
        description: `${stats.hosts} hosts, ${stats.snippets} snippets imported`,
      })
      onOpenChange(false)
    } catch (err) {
      setError(String(err))
      setStep('preview')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('teams.joinTeam')}</DialogTitle>
        </DialogHeader>

        {step === 'select' && (
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              {t('teams.joinTeamDesc')}
            </p>
            {error && (
              <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
                {error}
              </div>
            )}
            <Button onClick={handleSelectFile} className="w-full">
              <Upload className="size-4 mr-2" />
              {t('teams.selectPackageFile')}
            </Button>
          </div>
        )}

        {step === 'preview' && previewData && (
          <div className="space-y-4 py-4">
            <div className="p-4 bg-muted rounded-lg space-y-2">
              <div className="font-medium flex items-center gap-2">
                <Package className="size-4" />
                {previewData.teamName}
              </div>
              <div className="text-sm text-muted-foreground space-y-1">
                {previewData.hosts > 0 && (
                  <div>•{previewData.hosts} host(s)</div>
                )}
                {previewData.groups > 0 && (
                  <div>•{previewData.groups} group(s)</div>
                )}
                {previewData.snippets > 0 && (
                  <div>•{previewData.snippets} snippet(s)</div>
                )}
                {previewData.members > 0 && (
                  <div>•{previewData.members} member(s)</div>
                )}
              </div>
            </div>
            {error && (
              <div className="p-3 bg-destructive/10 text-destructive text-sm rounded-lg">
                {error}
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep('select')}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleImport}>
                <Download className="size-4 mr-2" />
                {t('teams.import')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'importing' && (
          <div className="py-8 text-center space-y-3">
            <RefreshCw className="size-8 mx-auto animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              {t('teams.importing')}
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
