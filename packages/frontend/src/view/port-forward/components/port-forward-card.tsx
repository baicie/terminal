import { Database, Globe, Link, Play, Server, Square, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { PortForwardEntry, PortForwardType } from './port-forward-types'

interface PortForwardCardProps {
  forward: PortForwardEntry
  onStart: (f: PortForwardEntry) => void
  onStop: (f: PortForwardEntry) => void
  onDelete: (f: PortForwardEntry) => void
}

const TYPE_BADGE_CLASSES: Record<PortForwardType, string> = {
  local: 'bg-info/10 text-info border-info/20',
  remote: 'bg-primary/10 text-primary border-primary/20',
  dynamic: 'bg-warning/10 text-warning border-warning/20',
}

const TYPE_LABELS: Record<PortForwardType, string> = {
  local: 'Local',
  remote: 'Remote',
  dynamic: 'Dynamic',
}

const TypeBadge: React.FC<{ type: PortForwardType }> = ({ type }) => (
  <Badge variant="outline" className={TYPE_BADGE_CLASSES[type]}>
    {TYPE_LABELS[type]}
  </Badge>
)

export const PortForwardCard: React.FC<PortForwardCardProps> = ({
  forward,
  onStart,
  onStop,
  onDelete,
}) => {
  return (
    <Card
      className={cn(
        'card-interactive transition-colors',
        !forward.active && 'opacity-60',
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">{forward.name}</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <TypeBadge type={forward.type} />
              {forward.active ? (
                <span className="flex items-center gap-1 text-success">
                  <span className="size-2 rounded-full bg-success animate-pulse" />
                  Active
                </span>
              ) : (
                <span className="text-muted-foreground">Stopped</span>
              )}
            </CardDescription>
          </div>
          <div className="flex gap-1">
            {forward.active ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                onClick={() => onStop(forward)}
              >
                <Square className="size-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-success hover:text-success"
                onClick={() => onStart(forward)}
              >
                <Play className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 hover:text-destructive"
              onClick={() => onDelete(forward)}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-start gap-2">
          <Globe className="size-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <div className="text-xs text-muted-foreground">Local</div>
            <div className="font-mono text-sm">
              {forward.localHost}:{forward.localPort}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 pl-1">
          <Link className="size-3 text-muted-foreground" />
          <div className="flex-1 h-px bg-border" />
          <Link className="size-3 text-muted-foreground" />
        </div>

        <div className="flex items-start gap-2">
          {forward.type === 'local' ? (
            <Database className="size-4 text-muted-foreground mt-0.5 shrink-0" />
          ) : (
            <Server className="size-4 text-muted-foreground mt-0.5 shrink-0" />
          )}
          <div className="space-y-0.5">
            <div className="text-xs text-muted-foreground">
              {forward.type === 'local'
                ? 'Remote'
                : forward.type === 'remote'
                  ? 'Local'
                  : 'SOCKS'}
            </div>
            <div className="font-mono text-sm">
              {forward.type === 'dynamic'
                ? 'SOCKS Proxy'
                : `${forward.remoteHost}:${forward.remotePort}`}
            </div>
          </div>
        </div>

        {forward.hostName && (
          <div className="pt-2 border-t text-xs text-muted-foreground">
            via {forward.hostName}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
