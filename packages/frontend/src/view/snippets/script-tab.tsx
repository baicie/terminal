import type { ScriptExecutionRecord, ScriptRecord } from '@/service/database'
import type { ScriptExecutionResult } from '@/service/scripts'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DialogTitle } from '@/components/ui/dialog'
import {
  ResponsiveConfirm,
  ResponsiveDialog,
} from '@/components/ui/responsive-dialog'
import { ViewToolbar } from '@/components/view-container'
import { ScriptFormDialogContent } from './script-form-dialog'
import { ScriptTabPanels } from './script-tab-panels'
import type { Host } from '@/types'

interface ScriptTabProps {
  scripts: ScriptRecord[]
  executions: ScriptExecutionRecord[]
  hosts: Host[]
  searchQuery: string
  isLoading: boolean
  selectedScript: ScriptRecord | null
  isEditDialogOpen: boolean
  isDeleteDialogOpen: boolean
  isExecuting: boolean
  formName: string
  formDescription: string
  formScript: string
  formHostIds: string[]
  formScheduleType: 'manual' | 'once' | 'interval' | 'cron'
  formScheduleValue: string
  formTimeout: number
  formRetryCount: number
  t: (key: string, options?: Record<string, unknown>) => string
  onSearchChange: (query: string) => void
  onOpenEditDialog: (script?: ScriptRecord) => void
  onSaveScript: () => Promise<void>
  onDeleteScript: () => Promise<void>
  onToggleEnabled: (script: ScriptRecord) => Promise<void>
  onExecuteScript: (script: ScriptRecord) => Promise<void>
  onFormChange: (field: string, value: string | string[] | number) => void
  onHostToggle: (hostId: string) => void
  onEditDialogOpenChange: (open: boolean) => void
  onDeleteDialogOpenChange: (open: boolean) => void
  onSelectedScriptChange: (script: ScriptRecord | null) => void
  onRefresh: () => void
  onResultChange: (result: ScriptExecutionResult | null) => void
}

export function ScriptTab({
  scripts,
  executions,
  hosts,
  searchQuery,
  isLoading,
  selectedScript,
  isEditDialogOpen,
  isDeleteDialogOpen,
  isExecuting,
  formName,
  formDescription,
  formScript,
  formHostIds,
  formScheduleType,
  formScheduleValue,
  formTimeout,
  formRetryCount,
  t,
  onSearchChange,
  onOpenEditDialog,
  onSaveScript,
  onDeleteScript,
  onToggleEnabled,
  onExecuteScript,
  onFormChange,
  onHostToggle,
  onEditDialogOpenChange,
  onDeleteDialogOpenChange,
  onSelectedScriptChange,
  onRefresh,
  onResultChange,
}: ScriptTabProps) {
  return (
    <div className="space-y-4">
      <ViewToolbar className="px-0 gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t('scripts.search')}
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Button size="sm" onClick={() => onOpenEditDialog()}>
          {t('scripts.new')}
        </Button>
      </ViewToolbar>

      <ScriptTabPanels
        scripts={scripts}
        executions={executions}
        hosts={hosts}
        isLoading={isLoading}
        isExecuting={isExecuting}
        t={t}
        onOpenEditDialog={onOpenEditDialog}
        onDeleteDialogOpenChange={onDeleteDialogOpenChange}
        onSelectedScriptChange={onSelectedScriptChange}
        onExecuteScript={onExecuteScript}
        onToggleEnabled={onToggleEnabled}
        onResultChange={onResultChange}
        onRefresh={onRefresh}
      />

      <ResponsiveDialog
        open={isEditDialogOpen}
        onOpenChange={onEditDialogOpenChange}
        header={
          <DialogTitle>
            {selectedScript ? t('scripts.edit') : t('scripts.create')}
          </DialogTitle>
        }
        footer={
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onEditDialogOpenChange(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button onClick={onSaveScript}>
              {selectedScript ? t('scripts.save') : t('scripts.create')}
            </Button>
          </div>
        }
        className="space-y-4 p-4"
        mobileHeight="90dvh"
      >
        <ScriptFormDialogContent
          script={selectedScript}
          hosts={hosts}
          formName={formName}
          formDescription={formDescription}
          formScript={formScript}
          formHostIds={formHostIds}
          formScheduleType={formScheduleType}
          formScheduleValue={formScheduleValue}
          formTimeout={formTimeout}
          formRetryCount={formRetryCount}
          onFormChange={onFormChange}
          onHostToggle={onHostToggle}
        />
      </ResponsiveDialog>

      <ResponsiveConfirm
        open={isDeleteDialogOpen}
        onOpenChange={onDeleteDialogOpenChange}
        title={t('scripts.deleteConfirm')}
        description={t('scripts.deleteConfirmDesc', {
          name: selectedScript?.name,
        })}
        confirmText={t('common.delete')}
        destructive
        onConfirm={onDeleteScript}
        onCancel={() => onSelectedScriptChange(null)}
      />
    </div>
  )
}
