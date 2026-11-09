import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readTextFile } from '@tauri-apps/plugin-fs'
import { RefreshCw, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { diagnoseImport, importTeamPackage, previewTeamPackage } from '@/service/sync'
import type { ImportSecretsDiagnosis, ImportSecretsPolicy } from '@/service/sync'
import { TeamPackagePreviewCard } from './team-package-preview-card'
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
  const [secrets, setSecrets] = useState<ImportSecretsDiagnosis | null>(null)
  const [previewData, setPreviewData] = useState<{
    teamName: string
    hosts: number
    groups: number
    snippets: number
    members: number
  } | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
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
          { name: t('teams.packageFileFilter'), extensions: ['json'] },
          { name: t('teams.allFilesFilter'), extensions: ['*'] },
        ],
      })

      if (selected) {
        const fileContent = await readTextFile(selected)
        const preview = previewTeamPackage(fileContent)

        if (preview) {
          setContent(fileContent)
          // A team package can carry plaintext secrets from an older build. The
          // decision is shown before Import is enabled, so the answer is the
          // user's, not a default that either leaks or silently drops.
          setSecrets(diagnoseImport(preview))
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

  const handleImport = async (policy: ImportSecretsPolicy = 'reject') => {
    if (!content) return

    setStep('importing')
    setLoading(true)
    try {
      const stats = await importTeamPackage(content, 'merge', { policy })
      await enableTeamMode({ mode: 'local' })
      toast.success(t('teams.importSuccess'), {
        description: t('teams.importedSummary', {
          hosts: stats.hosts,
          snippets: stats.snippets,
        }),
      })
      onOpenChange(false)
    } catch (err) {
      setError(String(err))
      setStep('preview')
    } finally {
      setLoading(false)
    }
  }

  const handleMigrateSecrets = () => void handleImport('migrate')
  const handleDiscardSecrets = () => void handleImport('discard')

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
          <TeamPackagePreviewCard
            preview={previewData}
            error={error}
            secrets={secrets}
            busy={loading}
            onCancel={() => setStep('select')}
            onImport={() => handleImport()}
            onMigrateSecrets={handleMigrateSecrets}
            onDiscardSecrets={handleDiscardSecrets}
          />
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
