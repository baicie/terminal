import type { Host } from '@/types'
import type { ScriptExecutionRecord, ScriptRecord } from '@/service/database'
import type { ScriptExecutionResult } from '@/service/scripts'
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Edit,
  Loader2,
  Play,
  Plus,
  Search,
  Server,
  Trash2,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import {
  EmptyState,
  ViewContainer,
  ViewContent,
  ViewToolbar,
} from '@/components/view-container'
import { formatDuration, formatRelativeTime } from '@/lib/date-utils'
import { getHosts } from '@/service/database'
import { scriptService } from '@/service/scripts'
import SnippetManager from '@/components/snippet-manager'

const SnippetsView: React.FC = () => {
  const { t } = useTranslation()
  const [snippetManagerOpen, setSnippetManagerOpen] = useState(false)

  // Scripts state
  const [scripts, setScripts] = useState<ScriptRecord[]>([])
  const [executions, setExecutions] = useState<ScriptExecutionRecord[]>([])
  const [hosts, setHosts] = useState<Host[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [selectedScript, setSelectedScript] = useState<ScriptRecord | null>(
    null,
  )
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isExecuting, setIsExecuting] = useState(false)
  const [executionResult, setExecutionResult] =
    useState<ScriptExecutionResult | null>(null)

  // Form state
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formScript, setFormScript] = useState('')
  const [formHostIds, setFormHostIds] = useState<string[]>([])
  const [formScheduleType, setFormScheduleType] = useState<
    'manual' | 'once' | 'interval' | 'cron'
  >('manual')
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
      setFormScheduleType(
        script.schedule_type as 'manual' | 'once' | 'interval' | 'cron',
      )
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
    setExecutionResult(null)

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

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />
      case 'failed':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'running':
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      case 'timeout':
        return <AlertCircle className="h-4 w-4 text-yellow-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-500" />
    }
  }

  const getStatusBadge = (status: string) => {
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

  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <Input placeholder={t('snippets.search')} className="max-w-xs h-9" />
        <div className="flex-1" />
        <Button size="sm" onClick={() => setSnippetManagerOpen(true)}>
          <Plus className="size-4 mr-1" data-icon="inline-start" />
          {t('snippets.new')}
        </Button>
      </ViewToolbar>

      <ViewContent className="p-6">
        <Tabs defaultValue="snippets" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="snippets">{t('snippets.title')}</TabsTrigger>
            <TabsTrigger value="scripts">{t('scripts.title')}</TabsTrigger>
          </TabsList>

          {/* Snippets Tab */}
          <TabsContent value="snippets" className="mt-0">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle>{t('snippets.title')}</CardTitle>
                <CardDescription>{t('snippets.description')}</CardDescription>
              </CardHeader>
              <CardContent>
                <SnippetManager
                  open={snippetManagerOpen}
                  onClose={() => setSnippetManagerOpen(false)}
                  onExecute={_script => {}}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* Scripts Tab */}
          <TabsContent value="scripts" className="mt-0 space-y-4">
            <ViewToolbar className="px-0 gap-4">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder={t('scripts.search')}
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9 h-9"
                />
              </div>
              <Button size="sm" onClick={() => openEditDialog()}>
                <Plus className="h-4 w-4 mr-1" data-icon="inline-start" />
                {t('scripts.new')}
              </Button>
            </ViewToolbar>

            <Tabs defaultValue="list" className="w-full">
              <TabsList className="mb-4">
                <TabsTrigger value="list">{t('scripts.list')}</TabsTrigger>
                <TabsTrigger value="history">
                  {t('scripts.history')}
                </TabsTrigger>
                <TabsTrigger value="batch">{t('scripts.batch')}</TabsTrigger>
              </TabsList>

              {/* Script List */}
              <TabsContent value="list" className="mt-0">
                {isLoading ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : scripts.length === 0 ? (
                  <EmptyState
                    title={t('scripts.empty')}
                    description={t('scripts.emptyDesc')}
                    action={
                      <Button onClick={() => openEditDialog()}>
                        <Plus
                          className="h-4 w-4 mr-1"
                          data-icon="inline-start"
                        />
                        {t('scripts.new')}
                      </Button>
                    }
                  />
                ) : (
                  <div className="grid gap-4">
                    {scripts.map(script => {
                      const hostIds: string[] = JSON.parse(
                        script.host_ids || '[]',
                      )
                      const hostCount = hostIds.length
                      return (
                        <Card
                          key={script.id}
                          className="hover:border-primary/50 transition-colors"
                        >
                          <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                              <div className="space-y-1">
                                <CardTitle className="text-lg">
                                  {script.name}
                                </CardTitle>
                                {script.description && (
                                  <CardDescription>
                                    {script.description}
                                  </CardDescription>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <Switch
                                  checked={!!script.enabled}
                                  onCheckedChange={() =>
                                    handleToggleEnabled(script)
                                  }
                                />
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handleExecuteScript(script)}
                                  disabled={isExecuting || hostCount === 0}
                                >
                                  <Play
                                    className="h-4 w-4 mr-1"
                                    data-icon="inline-start"
                                  />
                                  {t('scripts.run')}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => openEditDialog(script)}
                                >
                                  <Edit className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => {
                                    setSelectedScript(script)
                                    setIsDeleteDialogOpen(true)
                                  }}
                                >
                                  <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                              </div>
                            </div>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <div className="flex items-center gap-1">
                                <Server className="h-4 w-4" />
                                <span>
                                  {hostCount}{' '}
                                  {hostCount !== 1
                                    ? t('scripts.hosts')
                                    : t('scripts.host')}
                                </span>
                              </div>
                              <div className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                <span className="capitalize">
                                  {script.schedule_type}
                                </span>
                              </div>
                              {script.timeout_seconds && (
                                <Badge variant="outline">
                                  {script.timeout_seconds}s{' '}
                                  {t('scripts.timeout')}
                                </Badge>
                              )}
                            </div>
                            <pre className="mt-3 p-3 bg-muted rounded-md text-xs overflow-x-auto">
                              {script.script.length > 200
                                ? `${script.script.substring(0, 200)}...`
                                : script.script}
                            </pre>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                )}
              </TabsContent>

              {/* Execution History */}
              <TabsContent value="history" className="mt-0">
                {executions.length === 0 ? (
                  <EmptyState
                    title={t('scripts.noHistory')}
                    description={t('scripts.noHistoryDesc')}
                  />
                ) : (
                  <Card>
                    <CardContent className="p-0">
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
                                {getStatusBadge(execution.status)}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <Server className="h-4 w-4 text-muted-foreground" />
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
                    </CardContent>
                  </Card>
                )}
              </TabsContent>

              {/* Batch Execute */}
              <TabsContent value="batch" className="mt-0">
                <Card>
                  <CardHeader>
                    <CardTitle>{t('scripts.batchTitle')}</CardTitle>
                    <CardDescription>{t('scripts.batchDesc')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="host-select">
                        {t('scripts.selectHosts')}
                      </Label>
                      <div className="flex flex-wrap gap-2 p-3 border rounded-md max-h-48 overflow-y-auto">
                        {hosts.map(host => (
                          <div
                            key={host.id}
                            className="flex items-center gap-2"
                          >
                            <Checkbox
                              id={`host-${host.id}`}
                              checked={formHostIds.includes(host.id)}
                              onCheckedChange={() => handleHostToggle(host.id)}
                            />
                            <Label
                              htmlFor={`host-${host.id}`}
                              className="text-sm font-normal cursor-pointer"
                            >
                              {host.name}
                            </Label>
                          </div>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formHostIds.length}{' '}
                        {formHostIds.length !== 1
                          ? t('scripts.hostsSelected')
                          : t('scripts.hostSelected')}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="batch-command">
                        {t('scripts.command')}
                      </Label>
                      <Textarea
                        id="batch-command"
                        placeholder={t('scripts.enterCommand')}
                        value={formScript}
                        onChange={e => setFormScript(e.target.value)}
                        className="font-mono text-sm min-h-[100px]"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="batch-timeout">
                        {t('scripts.timeout')}
                      </Label>
                      <Input
                        id="batch-timeout"
                        type="number"
                        value={formTimeout}
                        onChange={e =>
                          setFormTimeout(Number.parseInt(e.target.value) || 60)
                        }
                        className="w-32"
                      />
                    </div>

                    <Button
                      onClick={() => {
                        if (formHostIds.length === 0) {
                          toast.error(t('scripts.selectAtLeastOne'))
                          return
                        }
                        if (!formScript.trim()) {
                          toast.error(t('scripts.enterCommand'))
                          return
                        }
                        scriptService
                          .executeOnHosts(formScript, formHostIds, formTimeout)
                          .then(result => {
                            setExecutionResult(result)
                            loadScripts()
                          })
                          .catch(error => {
                            toast.error(`Execution failed: ${error}`)
                          })
                      }}
                      disabled={formHostIds.length === 0 || !formScript.trim()}
                    >
                      <Play className="h-4 w-4 mr-1" data-icon="inline-start" />
                      {t('scripts.executeOnHosts', {
                        count: formHostIds.length,
                      })}
                    </Button>
                  </CardContent>
                </Card>

                {executionResult && (
                  <Card className="mt-4">
                    <CardHeader>
                      <CardTitle>{t('scripts.results')}</CardTitle>
                      <CardDescription>
                        {executionResult.successCount} {t('scripts.succeeded')},{' '}
                        {executionResult.failedCount} {t('scripts.failed')}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        {executionResult.results.map(result => (
                          <div
                            key={result.hostId}
                            className="p-3 border rounded-md"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="flex items-center gap-2">
                                {getStatusIcon(result.status)}
                                <span className="font-medium">
                                  {result.hostName}
                                </span>
                                <span className="text-muted-foreground text-sm">
                                  {result.hostAddress}
                                </span>
                              </div>
                              <span className="text-sm text-muted-foreground">
                                {formatDuration(result.durationMs)}
                              </span>
                            </div>
                            {result.output && (
                              <pre className="p-2 bg-muted rounded text-xs overflow-x-auto max-h-32">
                                {result.output}
                              </pre>
                            )}
                            {result.error && (
                              <p className="text-sm text-destructive">
                                {result.error}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </TabsContent>
            </Tabs>
          </TabsContent>
        </Tabs>
      </ViewContent>

      {/* Edit/Create Script Dialog */}
      <AlertDialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <AlertDialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectedScript ? t('scripts.edit') : t('scripts.create')}
            </AlertDialogTitle>
          </AlertDialogHeader>

          <div className="space-y-4 py-4 overflow-y-auto flex-1">
            <div className="space-y-2">
              <Label htmlFor="name">{t('scripts.name')} *</Label>
              <Input
                id="name"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder={t('scripts.namePlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">{t('scripts.description')}</Label>
              <Input
                id="description"
                value={formDescription}
                onChange={e => setFormDescription(e.target.value)}
                placeholder={t('scripts.descriptionPlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="script">{t('scripts.script')} *</Label>
              <Textarea
                id="script"
                value={formScript}
                onChange={e => setFormScript(e.target.value)}
                placeholder={t('scripts.scriptPlaceholder')}
                className="font-mono text-sm min-h-[150px]"
              />
            </div>

            <div className="space-y-2">
              <Label>{t('scripts.targetHosts')}</Label>
              <div className="flex flex-wrap gap-2 p-3 border rounded-md max-h-48 overflow-y-auto">
                {hosts.map(host => (
                  <div key={host.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`edit-host-${host.id}`}
                      checked={formHostIds.includes(host.id)}
                      onCheckedChange={() => handleHostToggle(host.id)}
                    />
                    <Label
                      htmlFor={`edit-host-${host.id}`}
                      className="text-sm font-normal cursor-pointer"
                    >
                      {host.name}
                    </Label>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {formHostIds.length}{' '}
                {formHostIds.length !== 1
                  ? t('scripts.hostsSelected')
                  : t('scripts.hostSelected')}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="schedule-type">
                  {t('scripts.scheduleType')}
                </Label>
                <Select
                  value={formScheduleType}
                  onValueChange={v =>
                    setFormScheduleType(v as typeof formScheduleType)
                  }
                >
                  <SelectTrigger id="schedule-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">
                      {t('scripts.manual')}
                    </SelectItem>
                    <SelectItem value="once">{t('scripts.once')}</SelectItem>
                    <SelectItem value="interval">
                      {t('scripts.interval')}
                    </SelectItem>
                    <SelectItem value="cron">{t('scripts.cron')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="schedule-value">
                  {t('scripts.scheduleValue')}
                </Label>
                <Input
                  id="schedule-value"
                  value={formScheduleValue}
                  onChange={e => setFormScheduleValue(e.target.value)}
                  placeholder={
                    formScheduleType === 'interval'
                      ? '60000'
                      : formScheduleType === 'cron'
                        ? '* * * * *'
                        : ''
                  }
                  disabled={formScheduleType === 'manual'}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="timeout">{t('scripts.timeoutSeconds')}</Label>
                <Input
                  id="timeout"
                  type="number"
                  value={formTimeout}
                  onChange={e =>
                    setFormTimeout(Number.parseInt(e.target.value) || 60)
                  }
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="retry-count">{t('scripts.retryCount')}</Label>
                <Input
                  id="retry-count"
                  type="number"
                  value={formRetryCount}
                  onChange={e =>
                    setFormRetryCount(Number.parseInt(e.target.value) || 0)
                  }
                />
              </div>
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setIsEditDialogOpen(false)}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleSaveScript}>
              {selectedScript ? t('scripts.save') : t('scripts.create')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('scripts.deleteConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('scripts.deleteConfirmDesc', { name: selectedScript?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteScript}
              className="bg-destructive text-destructive-foreground"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ViewContainer>
  )
}

export default SnippetsView
