import type { ScriptExecutionRecord } from '@/service/database'
import type { ScriptExecutionResult } from '@/service/scripts'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  ViewContainer,
  ViewContent,
  ViewHeader,
} from '@/components/view-container'
import { getHosts } from '@/service/database'
import { scriptService } from '@/service/scripts'
import SnippetManager from '@/components/snippet-manager'
import { ScriptTab } from './script-tab'
import type { Host, ScriptRecord } from '@/types'

const SnippetsView: React.FC = () => {
  const { t } = useTranslation()
  const [mainTab, setMainTab] = useState('snippets')

  const [scripts, setScripts] = useState<ScriptRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [selectedScript, setSelectedScript] = useState<ScriptRecord | null>(null)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [executions, setExecutions] = useState<ScriptExecutionRecord[]>([])
  const [hosts, setHosts] = useState<Host[]>([])
  const [, setExecutionResult] = useState<ScriptExecutionResult | null>(null)

  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formScript, setFormScript] = useState('')
  const [formHostIds, setFormHostIds] = useState<string[]>([])
  const [formScheduleType, setFormScheduleType] = useState<'manual' | 'once' | 'interval' | 'cron'>('manual')
  const [formScheduleValue, setFormScheduleValue] = useState('')
  const [formTimeout, setFormTimeout] = useState(60)
  const [formRetryCount, setFormRetryCount] = useState(0)

  const loadScripts = useCallback(async () => {
    setIsLoading(true)
    try {
      const [loadedScripts, loadedExecutions, loadedHosts] = await Promise.all([
        searchQuery
          ? scriptService.searchScripts(searchQuery)
          : scriptService.getAllScripts(),
        scriptService.getExecutions(undefined, 100),
        getHosts(),
      ])
      setScripts(loadedScripts)
      setExecutions(loadedExecutions)
      setHosts(loadedHosts)
    } catch (error) {
      toast.error(`Failed to load data: ${error}`)
    } finally {
      setIsLoading(false)
    }
  }, [searchQuery])

  useEffect(() => {
    loadScripts()
  }, [loadScripts])

  const openEditDialog = (script?: ScriptRecord) => {
    if (script) {
      setSelectedScript(script)
      setFormName(script.name)
      setFormDescription(script.description || '')
      setFormScript(script.script)
      setFormHostIds(JSON.parse(script.host_ids || '[]'))
      setFormScheduleType(script.schedule_type as 'manual' | 'once' | 'interval' | 'cron')
      setFormScheduleValue(script.schedule_value || '')
      setFormTimeout(script.timeout_seconds)
      setFormRetryCount(script.retry_count)
    } else {
      setSelectedScript(null)
      setFormName('')
      setFormDescription('')
      setFormScript('')
      setFormHostIds([])
      setFormScheduleType('manual')
      setFormScheduleValue('')
      setFormTimeout(60)
      setFormRetryCount(0)
    }
    setIsEditDialogOpen(true)
  }

  const handleSaveScript = async () => {
    if (!formName.trim() || !formScript.trim()) {
      toast.error(t('scripts.nameAndScriptRequired'))
      return
    }

    try {
      if (selectedScript) {
        await scriptService.updateScript(selectedScript.id, {
          name: formName,
          description: formDescription,
          script: formScript,
          hostIds: formHostIds,
          scheduleType: formScheduleType,
          scheduleValue: formScheduleValue,
          timeoutSeconds: formTimeout,
          retryCount: formRetryCount,
        })
        toast.success(t('scripts.updated'))
      } else {
        await scriptService.createScript({
          name: formName,
          description: formDescription,
          script: formScript,
          hostIds: formHostIds,
          scheduleType: formScheduleType,
          scheduleValue: formScheduleValue,
          timeoutSeconds: formTimeout,
          retryCount: formRetryCount,
        })
        toast.success(t('scripts.created'))
      }
      setIsEditDialogOpen(false)
      setSelectedScript(null)
      loadScripts()
    } catch (error) {
      toast.error(`Failed to save script: ${error}`)
    }
  }

  const handleDeleteScript = async () => {
    if (!selectedScript) return
    try {
      await scriptService.deleteScript(selectedScript.id)
      toast.success(t('scripts.deleted'))
      setIsDeleteDialogOpen(false)
      setSelectedScript(null)
      loadScripts()
    } catch (error) {
      toast.error(`Failed to delete script: ${error}`)
    }
  }

  const handleToggleEnabled = async (script: ScriptRecord) => {
    try {
      await scriptService.toggleEnabled(script.id)
      loadScripts()
    } catch (error) {
      toast.error(`Failed to toggle script: ${error}`)
    }
  }

  const handleExecuteScript = async (script: ScriptRecord) => {
    const hostIds: string[] = JSON.parse(script.host_ids || '[]')
    if (hostIds.length === 0) {
      toast.error(t('scripts.noHosts'))
      return
    }

    setIsExecuting(true)
    try {
      const result = await scriptService.executeOnHosts(
        script.script,
        hostIds,
        script.timeout_seconds,
      )
      setExecutionResult(result)
      loadScripts()
    } catch (error) {
      toast.error(`Execution failed: ${error}`)
    } finally {
      setIsExecuting(false)
    }
  }

  const handleHostToggle = (hostId: string) => {
    setFormHostIds(prev =>
      prev.includes(hostId)
        ? prev.filter(id => id !== hostId)
        : [...prev, hostId],
    )
  }

  const handleFormChange = (field: string, value: string | string[] | number) => {
    switch (field) {
      case 'name': setFormName(value as string); break
      case 'description': setFormDescription(value as string); break
      case 'script': setFormScript(value as string); break
      case 'scheduleType': setFormScheduleType(value as 'manual' | 'once' | 'interval' | 'cron'); break
      case 'scheduleValue': setFormScheduleValue(value as string); break
      case 'timeout': setFormTimeout(value as number); break
      case 'retryCount': setFormRetryCount(value as number); break
    }
  }

  return (
    <ViewContainer>
      <ViewHeader
        title={t('snippets.pageTitle')}
        description={t('snippets.description')}
      />

      <ViewContent className="flex min-h-0 flex-col px-4 pb-6 sm:px-6">
        <Tabs
          value={mainTab}
          onValueChange={setMainTab}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          <TabsList className="grid h-auto w-full grid-cols-2 p-1 sm:inline-flex sm:w-auto">
            <TabsTrigger value="snippets">{t('snippets.title')}</TabsTrigger>
            <TabsTrigger value="scripts">{t('scripts.title')}</TabsTrigger>
          </TabsList>

          <TabsContent
            value="snippets"
            className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            <SnippetManager onExecute={_script => {}} />
          </TabsContent>

          <TabsContent
            value="scripts"
            className="mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
          >
            <ScriptTab
              scripts={scripts}
              executions={executions}
              hosts={hosts}
              searchQuery={searchQuery}
              isLoading={isLoading}
              selectedScript={selectedScript}
              isEditDialogOpen={isEditDialogOpen}
              isDeleteDialogOpen={isDeleteDialogOpen}
              isExecuting={isExecuting}
              formName={formName}
              formDescription={formDescription}
              formScript={formScript}
              formHostIds={formHostIds}
              formScheduleType={formScheduleType}
              formScheduleValue={formScheduleValue}
              formTimeout={formTimeout}
              formRetryCount={formRetryCount}
              t={t}
              onSearchChange={setSearchQuery}
              onOpenEditDialog={openEditDialog}
              onSaveScript={handleSaveScript}
              onDeleteScript={handleDeleteScript}
              onToggleEnabled={handleToggleEnabled}
              onExecuteScript={handleExecuteScript}
              onFormChange={handleFormChange}
              onHostToggle={handleHostToggle}
              onEditDialogOpenChange={setIsEditDialogOpen}
              onDeleteDialogOpenChange={setIsDeleteDialogOpen}
              onSelectedScriptChange={setSelectedScript}
              onRefresh={loadScripts}
              onResultChange={setExecutionResult}
            />
          </TabsContent>
        </Tabs>
      </ViewContent>
    </ViewContainer>
  )
}

export default SnippetsView
