import type { ScriptRecord } from '@/service/database'
import { Edit, Play, Server, Trash2, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { t } from 'i18next'

interface ScriptListProps {
  scripts: ScriptRecord[]
  isLoading: boolean
  onEdit: (script: ScriptRecord) => void
  onDelete: (script: ScriptRecord) => void
  onExecute: (script: ScriptRecord) => void
  onToggleEnabled: (script: ScriptRecord) => void
  isExecuting: boolean
}

export const ScriptList: React.FC<ScriptListProps> = ({
  scripts,
  isLoading,
  onEdit,
  onDelete,
  onExecute,
  onToggleEnabled,
  isExecuting,
}) => {
  const { t: tr } = useTranslation()

  if (isLoading) {
    return <div>Loading...</div>
  }

  if (scripts.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-8">
        {tr('scripts.empty')}
      </div>
    )
  }

  return (
    <div className="grid gap-4">
      {scripts.map(script => {
        const hostIds: string[] = JSON.parse(script.host_ids || '[]')
        const hostCount = hostIds.length
        return (
          <Card key={script.id} className="hover:border-primary/50 transition-colors">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-lg">{script.name}</CardTitle>
                  {script.description && (
                    <CardDescription>{script.description}</CardDescription>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={!!script.enabled}
                    onCheckedChange={() => onToggleEnabled(script)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onExecute(script)}
                    disabled={isExecuting || hostCount === 0}
                  >
                    <Play className="h-4 w-4 mr-1" data-icon="inline-start" />
                    {tr('scripts.run')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onEdit(script)}>
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(script)}>
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
                    {hostCount} {hostCount !== 1 ? tr('scripts.hosts') : tr('scripts.host')}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  <span className="capitalize">{script.schedule_type}</span>
                </div>
                {script.timeout_seconds && (
                  <Badge variant="outline">
                    {script.timeout_seconds}s {tr('scripts.timeout')}
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
  )
}
