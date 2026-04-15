import type { ScriptExecutionRecord, ScriptRecord } from '@/service/database'
import type { ScriptExecutionResult } from '@/service/scripts'
import { Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResponsiveConfirm } from '@/components/ui/responsive-dialog'
import { SnippetRowSkeleton } from '@/components/ui/view-skeletons'
import {
  EmptyState,
  ViewToolbar,
} from '@/components/view-container'
import { formatDuration, formatRelativeTime } from '@/lib/date-utils'
import { ScriptList } from './script-list'
import { ScriptFormDialogContent } from './script-form-dialog'
import { BatchExecutePanel } from './batch-execute-panel'
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
  t: (key: string) => string
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
  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'destructive' | 'outline' | 'secondary'> = {
      success: 'default',
      failed: 'destructive',
      running: 'secondary',
      timeout: 'outline',
    }
    return (
      <Badge variant={variants[status] || 'outline'} className="capitalize">
        {status}
      </Badge>
    )
  }

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

      <Tabs defaultValue="list" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="list">{t('scripts.list')}</TabsTrigger>
          <TabsTrigger value="history">{t('scripts.history')}</TabsTrigger>
          <TabsTrigger value="batch">{t('scripts.batch')}</TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-0">
          {isLoading ? (
            <SnippetRowSkeleton count={8} />
          ) : scripts.length === 0 ? (
            <EmptyState
              title={t('scripts.empty')}
              description={t('scripts.emptyDesc')}
              action={
                <Button onClick={() => onOpenEditDialog()}>
                  {t('scripts.new')}
                </Button>
              }
            />
          ) : (
            <ScriptList
              scripts={scripts}
              isLoading={isLoading}
              onEdit={onOpenEditDialog}
              onDelete={script => {
                onSelectedScriptChange(script)
                onDeleteDialogOpenChange(true)
              }}
              onExecute={onExecuteScript}
              onToggleEnabled={onToggleEnabled}
              isExecuting={isExecuting}
            />
          )}
        </TabsContent>

        <TabsContent value="history" className="mt-0">
          {executions.length === 0 ? (
            <EmptyState
              title={t('scripts.noHistory')}
              description={t('scripts.noHistoryDesc')}
            />
          ) : (
            <Card>
              <Card className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('scripts.status')}</TableHead>
                      <TableHead>{t('scripts.host')}</TableHead>
                      <TableHead>{t('scripts.script')}</TableHead>
                      <TableHead>{t('scripts.started')}</TableHead>
                      <TableHead>{t('scripts.duration')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {executions.map(execution => (
                      <TableRow key={execution.id}>
                        <TableCell>{getStatusBadge(execution.status)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span>{execution.host_name || 'N/A'}</span>
                            <span className="text-muted-foreground text-xs">
                              {execution.host_address}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {execution.script_name}
                        </TableCell>
                        <TableCell>
                          {formatRelativeTime(execution.started_at)}
                        </TableCell>
                        <TableCell>
                          {execution.duration_ms
                            ? formatDuration(execution.duration_ms)
                            : '-'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Card>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="batch" className="mt-0">
          <BatchExecutePanel
            hosts={hosts}
            onResult={onResultChange}
            onRefresh={onRefresh}
          />
        </TabsContent>
      </Tabs>

      <ResponsiveConfirm
        open={isEditDialogOpen}
        onOpenChange={onEditDialogOpenChange}
        title={selectedScript ? t('scripts.edit') : t('scripts.create')}
        confirmText={selectedScript ? t('scripts.save') : t('scripts.create')}
        onConfirm={onSaveScript}
        onCancel={() => onEditDialogOpenChange(false)}
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
      </ResponsiveConfirm>

      <ResponsiveConfirm
        open={isDeleteDialogOpen}
        onOpenChange={onDeleteDialogOpenChange}
        title={t('scripts.deleteConfirm')}
        description={t('scripts.deleteConfirmDesc', { name: selectedScript?.name })}
        confirmText={t('common.delete')}
        destructive
        onConfirm={onDeleteScript}
        onCancel={() => onSelectedScriptChange(null)}
      />
    </div>
  )
}
