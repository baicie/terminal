import type { Host } from '@/types'
import type { ScriptExecutionResult } from '@/service/scripts'
import { Play, Server , CheckCircle, XCircle, AlertCircle, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { scriptService } from '@/service/scripts'
import { formatDuration } from '@/lib/date-utils'
import { Badge } from '@/components/ui/badge'

interface BatchExecutePanelProps {
  hosts: Host[]
  onResult: (result: ScriptExecutionResult) => void
  onRefresh: () => void
}

export const BatchExecutePanel: React.FC<BatchExecutePanelProps> = ({
  hosts,
  onResult,
  onRefresh,
}) => {
  const { t } = useTranslation()
  const [selectedHostIds, setSelectedHostIds] = useState<string[]>([])
  const [command, setCommand] = useState('')
  const [timeout, setTimeout] = useState(60)
  const [isExecuting, setIsExecuting] = useState(false)
  const [result, setResult] = useState<ScriptExecutionResult | null>(null)

  const handleHostToggle = (hostId: string) => {
    setSelectedHostIds(prev =>
      prev.includes(hostId)
        ? prev.filter(id => id !== hostId)
        : [...prev, hostId],
    )
  }

  const handleExecute = async () => {
    if (selectedHostIds.length === 0) {
      toast.error(t('scripts.selectAtLeastOne'))
      return
    }
    if (!command.trim()) {
      toast.error(t('scripts.enterCommand'))
      return
    }

    setIsExecuting(true)
    setResult(null)

    try {
      const execResult = await scriptService.executeOnHosts(command, selectedHostIds, timeout)
      setResult(execResult)
      onResult(execResult)
      onRefresh()
    } catch (error) {
      toast.error(`Execution failed: ${error}`)
    } finally {
      setIsExecuting(false)
    }
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
        return <Server className="h-4 w-4 text-gray-500" />
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('scripts.batchTitle')}</CardTitle>
        <CardDescription>{t('scripts.batchDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Select Hosts</Label>
          <div className="flex flex-wrap gap-2 p-3 border rounded-md max-h-48 overflow-y-auto">
            {hosts.map(host => (
              <div key={host.id} className="flex items-center gap-2">
                <Checkbox
                  id={`batch-host-${host.id}`}
                  checked={selectedHostIds.includes(host.id)}
                  onCheckedChange={() => handleHostToggle(host.id)}
                />
                <Label htmlFor={`batch-host-${host.id}`} className="text-sm font-normal cursor-pointer">
                  {host.name}
                </Label>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {selectedHostIds.length} {selectedHostIds.length !== 1 ? 'hosts selected' : 'host selected'}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="batch-command">Command</Label>
          <Textarea
            id="batch-command"
            placeholder="Enter command..."
            value={command}
            onChange={e => setCommand(e.target.value)}
            className="font-mono text-sm min-h-[100px]"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="batch-timeout">Timeout (seconds)</Label>
          <Input
            id="batch-timeout"
            type="number"
            value={timeout}
            onChange={e => setTimeout(Number.parseInt(e.target.value) || 60)}
            className="w-32"
          />
        </div>

        <Button
          onClick={handleExecute}
          disabled={selectedHostIds.length === 0 || !command.trim() || isExecuting}
        >
          <Play className="h-4 w-4 mr-1" data-icon="inline-start" />
          {t('scripts.executeOnHosts', { count: selectedHostIds.length })}
        </Button>

        {result && (
          <Card className="mt-4">
            <CardHeader>
              <CardTitle>{t('scripts.results')}</CardTitle>
              <CardDescription>
                {result.successCount} {t('scripts.succeeded')}, {result.failedCount} {t('scripts.failed')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {result.results.map(r => (
                  <div key={r.hostId} className="p-3 border rounded-md">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(r.status)}
                        <span className="font-medium">{r.hostName}</span>
                        <span className="text-muted-foreground text-sm">{r.hostAddress}</span>
                      </div>
                      <span className="text-sm text-muted-foreground">{formatDuration(r.durationMs)}</span>
                    </div>
                    {r.output && (
                      <pre className="p-2 bg-muted rounded text-xs overflow-x-auto max-h-32">{r.output}</pre>
                    )}
                    {r.error && (
                      <p className="text-sm text-destructive">{r.error}</p>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  )
}
