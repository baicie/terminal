import React, { useState, useEffect, useCallback } from 'react'
import {
  ViewContainer,
  ViewToolbar,
  ViewContent,
  EmptyState,
} from '@/components/view-container'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { scriptService, type ScriptExecutionResult } from '@/service/scripts'
import {
  getHosts,
  type ScriptRecord,
  type ScriptExecutionRecord,
  type Host,
} from '@/service/database'
import { formatDuration, formatRelativeTime } from '@/lib/date-utils'
import { toast } from 'sonner'
import {
  Plus,
  Play,
  Trash2,
  Edit,
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Search,
  Server,
} from 'lucide-react'

const ScriptsView: React.FC = () => {
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

  const loadData = useCallback(async () => {
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
    loadData()
  }, [loadData])

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

  const closeEditDialog = () => {
    setIsEditDialogOpen(false)
    setSelectedScript(null)
  }

  const handleSave = async () => {
    if (!formName.trim() || !formScript.trim()) {
      toast.error('Name and script are required')
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
        toast.success('Script updated successfully')
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
        toast.success('Script created successfully')
      }
      closeEditDialog()
      loadData()
    } catch (error) {
      toast.error(`Failed to save script: ${error}`)
    }
  }

  const handleDelete = async () => {
    if (!selectedScript) return
    try {
      await scriptService.deleteScript(selectedScript.id)
      toast.success('Script deleted successfully')
      setIsDeleteDialogOpen(false)
      setSelectedScript(null)
      loadData()
    } catch (error) {
      toast.error(`Failed to delete script: ${error}`)
    }
  }

  const handleToggleEnabled = async (script: ScriptRecord) => {
    try {
      await scriptService.toggleEnabled(script.id)
      loadData()
    } catch (error) {
      toast.error(`Failed to toggle script: ${error}`)
    }
  }

  const handleExecute = async (script: ScriptRecord) => {
    const hostIds: string[] = JSON.parse(script.host_ids || '[]')
    if (hostIds.length === 0) {
      toast.error('No hosts selected for this script')
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
      loadData()
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
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search scripts..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>
        <Button size="sm" onClick={() => openEditDialog()}>
          <Plus className="h-4 w-4 mr-1" data-icon="inline-start" />
          New Script
        </Button>
      </ViewToolbar>

      <ViewContent className="p-6">
        <Tabs defaultValue="scripts" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="scripts">Scripts</TabsTrigger>
            <TabsTrigger value="executions">Execution History</TabsTrigger>
            <TabsTrigger value="batch">Batch Execute</TabsTrigger>
          </TabsList>

          <TabsContent value="scripts" className="space-y-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : scripts.length === 0 ? (
              <EmptyState
                title="No scripts yet"
                description="Create your first script to automate tasks across multiple hosts"
                action={
                  <Button onClick={() => openEditDialog()}>
                    <Plus className="h-4 w-4 mr-1" data-icon="inline-start" />
                    New Script
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-4">
                {scripts.map(script => {
                  const hostIds: string[] = JSON.parse(script.host_ids || '[]')
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
                              onClick={() => handleExecute(script)}
                              disabled={isExecuting || hostCount === 0}
                            >
                              <Play
                                className="h-4 w-4 mr-1"
                                data-icon="inline-start"
                              />
                              Run
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
                              {hostCount} host{hostCount !== 1 ? 's' : ''}
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
                              {script.timeout_seconds}s timeout
                            </Badge>
                          )}
                        </div>
                        <pre className="mt-3 p-3 bg-muted rounded-md text-xs overflow-x-auto">
                          {script.script.length > 200
                            ? script.script.substring(0, 200) + '...'
                            : script.script}
                        </pre>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="executions" className="space-y-4">
            {executions.length === 0 ? (
              <EmptyState
                title="No execution history"
                description="Run a script to see execution results here"
              />
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Status</TableHead>
                        <TableHead>Host</TableHead>
                        <TableHead>Script</TableHead>
                        <TableHead>Started</TableHead>
                        <TableHead>Duration</TableHead>
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

          <TabsContent value="batch" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Quick Batch Execute</CardTitle>
                <CardDescription>
                  Execute a command on multiple hosts without saving as a script
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="host-select">Select Hosts</Label>
                  <div className="flex flex-wrap gap-2 p-3 border rounded-md max-h-48 overflow-y-auto">
                    {hosts.map(host => (
                      <div key={host.id} className="flex items-center gap-2">
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
                    {formHostIds.length} host(s) selected
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="batch-command">Command</Label>
                  <Textarea
                    id="batch-command"
                    placeholder="Enter command to execute..."
                    value={formScript}
                    onChange={e => setFormScript(e.target.value)}
                    className="font-mono text-sm min-h-[100px]"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="batch-timeout">Timeout (seconds)</Label>
                  <Input
                    id="batch-timeout"
                    type="number"
                    value={formTimeout}
                    onChange={e =>
                      setFormTimeout(parseInt(e.target.value) || 60)
                    }
                    className="w-32"
                  />
                </div>

                <Button
                  onClick={() => {
                    if (formHostIds.length === 0) {
                      toast.error('Please select at least one host')
                      return
                    }
                    if (!formScript.trim()) {
                      toast.error('Please enter a command')
                      return
                    }
                    scriptService
                      .executeOnHosts(formScript, formHostIds, formTimeout)
                      .then(result => {
                        setExecutionResult(result)
                        loadData()
                      })
                      .catch(error => {
                        toast.error(`Execution failed: ${error}`)
                      })
                  }}
                  disabled={formHostIds.length === 0 || !formScript.trim()}
                >
                  <Play className="h-4 w-4 mr-1" data-icon="inline-start" />
                  Execute on {formHostIds.length} Host(s)
                </Button>
              </CardContent>
            </Card>

            {executionResult && (
              <Card>
                <CardHeader>
                  <CardTitle>Execution Results</CardTitle>
                  <CardDescription>
                    {executionResult.successCount} succeeded,{' '}
                    {executionResult.failedCount} failed
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
      </ViewContent>

      {/* Edit/Create Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {selectedScript ? 'Edit Script' : 'Create New Script'}
            </DialogTitle>
            <DialogDescription>
              {selectedScript
                ? 'Modify your script configuration'
                : 'Create a new script for batch execution and scheduling'}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 px-1">
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Script name"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="Brief description"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="script">Script *</Label>
                <Textarea
                  id="script"
                  value={formScript}
                  onChange={e => setFormScript(e.target.value)}
                  placeholder="Enter command(s) to execute..."
                  className="font-mono text-sm min-h-[150px]"
                />
              </div>

              <div className="space-y-2">
                <Label>Target Hosts</Label>
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
                  {formHostIds.length} host(s) selected
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="schedule-type">Schedule Type</Label>
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
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="once">Once</SelectItem>
                      <SelectItem value="interval">Interval</SelectItem>
                      <SelectItem value="cron">Cron</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="schedule-value">
                    {formScheduleType === 'interval'
                      ? 'Interval (ms)'
                      : formScheduleType === 'cron'
                        ? 'Cron Expression'
                        : formScheduleType === 'once'
                          ? 'Delay (ms)'
                          : 'Schedule Value'}
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
                          : formScheduleType === 'once'
                            ? '3600000'
                            : ''
                    }
                    disabled={formScheduleType === 'manual'}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="timeout">Timeout (seconds)</Label>
                  <Input
                    id="timeout"
                    type="number"
                    value={formTimeout}
                    onChange={e =>
                      setFormTimeout(parseInt(e.target.value) || 60)
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="retry-count">Retry Count</Label>
                  <Input
                    id="retry-count"
                    type="number"
                    value={formRetryCount}
                    onChange={e =>
                      setFormRetryCount(parseInt(e.target.value) || 0)
                    }
                  />
                </div>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter>
            <Button variant="outline" onClick={closeEditDialog}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {selectedScript ? 'Save Changes' : 'Create Script'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Script</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{selectedScript?.name}"? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ViewContainer>
  )
}

export default ScriptsView
