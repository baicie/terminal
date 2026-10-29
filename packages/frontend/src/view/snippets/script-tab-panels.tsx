import type { ScriptExecutionRecord, ScriptRecord } from '@/service/database'
import type { ScriptExecutionResult } from '@/service/scripts'
import type { Host } from '@/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SnippetRowSkeleton } from '@/components/ui/view-skeletons'
import { EmptyState } from '@/components/view-container'
import { formatDuration, formatRelativeTime } from '@/lib/date-utils'
import { BatchExecutePanel } from './batch-execute-panel'
import { ScriptList } from './script-list'

interface ScriptTabPanelsProps {
  scripts: ScriptRecord[]
  executions: ScriptExecutionRecord[]
  hosts: Host[]
  isLoading: boolean
  isExecuting: boolean
  t: (key: string, options?: Record<string, unknown>) => string
  onOpenEditDialog: (script?: ScriptRecord) => void
  onDeleteDialogOpenChange: (open: boolean) => void
  onSelectedScriptChange: (script: ScriptRecord | null) => void
  onExecuteScript: (script: ScriptRecord) => Promise<void>
  onToggleEnabled: (script: ScriptRecord) => Promise<void>
  onResultChange: (result: ScriptExecutionResult | null) => void
  onRefresh: () => void
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<
    string,
    'default' | 'destructive' | 'outline' | 'secondary'
  > = {
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

export function ScriptTabPanels({
  scripts,
  executions,
  hosts,
  isLoading,
  isExecuting,
  t,
  onOpenEditDialog,
  onDeleteDialogOpenChange,
  onSelectedScriptChange,
  onExecuteScript,
  onToggleEnabled,
  onResultChange,
  onRefresh,
}: ScriptTabPanelsProps) {
  return (
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
                      <TableCell>
                        <StatusBadge status={execution.status} />
                      </TableCell>
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
  )
}
