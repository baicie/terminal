import { useState } from 'react'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/sonner'
import { exportDataToFile, importDataWithSecretPolicy } from '@/service/sync'
import { ExportIntegrityError } from '@/service/export-sanitize'
import type { ImportSecretsDiagnosis, ImportSecretsPolicy } from '@/service/sync'
import { CredentialMigrationPanel } from './credential-migration-panel'
import { ExportImportContent } from './export-import-content'
import {
  selectImportFile,
  type ImportMode,
  type ImportPreview,
} from './export-import-operations'

type ImportStep = 'idle' | 'preview' | 'secrets-decided' | 'importing' | 'success' | 'error'
interface ExportImportSettingsProps {
  onClose?: () => void
}

export function ExportImportSettings({ onClose }: ExportImportSettingsProps) {
  const [exporting, setExporting] = useState(false)
  const [importMode, setImportMode] = useState<ImportMode>('merge')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importContent, setImportContent] = useState<string | null>(null)
  const [importSecrets, setImportSecrets] = useState<ImportSecretsDiagnosis | null>(
    null,
  )
  const [needsRebind, setNeedsRebind] = useState<
    ImportSecretsDiagnosis['sourceCredentialRefs']
  >([])
  const [importStep, setImportStep] = useState<ImportStep>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const resetSyncState = () => {
    setImportStep('idle')
    setImportPreview(null)
    setImportContent(null)
    setImportSecrets(null)
    setNeedsRebind([])
    setErrorMessage(null)
    setImportMode('merge')
  }

  const handleExport = async () => {
    setExporting(true)
    setErrorMessage(null)
    try {
      const filePath = await exportDataToFile()
      if (filePath)
        toast.success('Export successful', { description: filePath })
    } catch (error) {
      console.error('Export failed:', error)
      // An integrity refusal already explains itself: it names the host and the
      // reason and says what to do. Prefixing it with "Export failed: Error:"
      // buries the one sentence the user needs.
      setErrorMessage(
        error instanceof ExportIntegrityError
          ? error.message
          : `Export failed: ${error}`,
      )
    } finally {
      setExporting(false)
    }
  }

  const handleSelectImportFile = async () => {
    try {
      const result = await selectImportFile()
      if (result) {
        setImportContent(result.content)
        setImportPreview(result.preview)
        setImportSecrets(result.secrets)
        setNeedsRebind([])
        setImportStep('preview')
      }
    } catch (error) {
      console.error('Failed to read file:', error)
      setErrorMessage(`Failed to read file: ${error}`)
      setImportStep('error')
    }
  }

  const runImport = async (policy: ImportSecretsPolicy) => {
    if (!importContent) return
    setImportStep('importing')
    setErrorMessage(null)
    try {
      const { diagnosis } = await importDataWithSecretPolicy(
        importContent,
        importMode,
        { policy },
      )
      // A migrated file's rows carry a reference; the rest still need the user.
      // Both cases are reported, because "imported" is not "ready to connect".
      const stillMissing = policy === 'migrate' ? [] : diagnosis.rows
      setNeedsRebind([
        ...diagnosis.sourceCredentialRefs,
        ...stillMissing.filter(
          row =>
            !diagnosis.sourceCredentialRefs.some(
              known => known.resource === row.resource && known.id === row.id,
            ),
        ),
      ])
      setImportStep('success')
    } catch (error) {
      console.error('Import failed:', error)
      setErrorMessage(`Import failed: ${error}`)
      setImportStep('error')
    }
  }

  const handleImport = async () => {
    if (!importSecrets) return
    if (importSecrets.needsDecision) {
      // The decision panel is shown instead of a plain Import button; reaching here
      // without one would mean the UI let a file with plaintext through.
      return
    }
    setImportStep('secrets-decided')
    await runImport('reject')
  }

  return (
    <div className="space-y-6">
    <ExportImportContent
      exporting={exporting}
      importMode={importMode}
      preview={importPreview}
      content={importContent}
      step={importStep}
      errorMessage={errorMessage}
      secrets={importSecrets}
      needsRebind={needsRebind}
      onExport={handleExport}
      onSelect={handleSelectImportFile}
      onModeChange={setImportMode}
      onReset={resetSyncState}
      onImport={handleImport}
      onMigrateSecrets={() => runImport('migrate')}
      onDiscardSecrets={() => runImport('discard')}
      onCancelSecrets={resetSyncState}
      onClose={onClose}
    />
    <Separator />
    <CredentialMigrationPanel />
    </div>
  )
}
