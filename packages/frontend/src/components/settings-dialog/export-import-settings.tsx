import { useState } from 'react'
import { toast } from '@/components/ui/sonner'
import { exportDataToFile } from '@/service/sync'
import { ExportImportContent } from './export-import-content'
import {
  importExportData,
  selectImportFile,
  type ImportMode,
  type ImportPreview,
} from './export-import-operations'

type ImportStep = 'idle' | 'preview' | 'importing' | 'success' | 'error'
interface ExportImportSettingsProps {
  onClose?: () => void
}

export function ExportImportSettings({ onClose }: ExportImportSettingsProps) {
  const [exporting, setExporting] = useState(false)
  const [importMode, setImportMode] = useState<ImportMode>('merge')
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importContent, setImportContent] = useState<string | null>(null)
  const [importStep, setImportStep] = useState<ImportStep>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const resetSyncState = () => {
    setImportStep('idle')
    setImportPreview(null)
    setImportContent(null)
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
      setErrorMessage(`Export failed: ${error}`)
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
        setImportStep('preview')
      }
    } catch (error) {
      console.error('Failed to read file:', error)
      setErrorMessage(`Failed to read file: ${error}`)
      setImportStep('error')
    }
  }
  const handleImport = async () => {
    if (!importContent) return
    setImportStep('importing')
    try {
      await importExportData(importContent, importMode)
      setImportStep('success')
      setTimeout(() => onClose?.(), 1500)
    } catch (error) {
      console.error('Import failed:', error)
      setErrorMessage(`Import failed: ${error}`)
      setImportStep('error')
    }
  }
  return (
    <ExportImportContent
      exporting={exporting}
      importMode={importMode}
      preview={importPreview}
      content={importContent}
      step={importStep}
      errorMessage={errorMessage}
      onExport={handleExport}
      onSelect={handleSelectImportFile}
      onModeChange={setImportMode}
      onReset={resetSyncState}
      onImport={handleImport}
    />
  )
}
