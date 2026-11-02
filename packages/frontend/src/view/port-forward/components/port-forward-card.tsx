import { Database, Globe, Link, Play, Server, Square, Trash2 } from 'lucide-react'
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

const TYPE_LABEL_KEYS: Record<PortForwardType, string> = {
  local: 'portForward.local',
  remote: 'portForward.remote',
  dynamic: 'portForward.dynamic',
}

const TypeBadge: React.FC<{ type: PortForwardType }> = ({ type }) => {
  const { t } = useTranslation()
  return (
    <Badge variant="outline" className={TYPE_BADGE_CLASSES[type]}>
      {t(TYPE_LABEL_KEYS[type])}
    </Badge>
  )
}

export const PortForwardCard: React.FC<PortForwardCardProps> = ({
  forward,
  onStart,
  onStop,
  onDelete,
}) => {
  const { t } = useTranslation()
  const startLabel = t('portForwardView.startAction', { name: forward.name })
  const stopLabel = t('portForwardView.stopAction', { name: forward.name })
  const deleteLabel = t('portForwardView.deleteAction', { name: forward.name })

  return (
    <Card
      className={cn(
        'card-interactive transition-colors',
        !forward.active && 'opacity-60',
      )}
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base truncate">{forward.name}</CardTitle>
            <CardDescription className="flex flex-wrap items-center gap-2">
              <TypeBadge type={forward.type} />
              {forward.active ? (
                <span className="flex items-center gap-1 text-success whitespace-nowrap">
                  <span className="size-2 rounded-full bg-success motion-safe:animate-pulse" />
                  {t('portForward.active')}
                </span>
              ) : (
                <span className="text-muted-foreground whitespace-nowrap">
                  {t('portForward.stopped')}
                </span>
              )}
            </CardDescription>
          </div>
          <div className="flex shrink-0 gap-1">
            {forward.active ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-destructive hover:text-destructive"
                onClick={() => onStop(forward)}
                aria-label={stopLabel}
                title={stopLabel}
                data-testid="port-forward-card-stop"
              >
                <Square className="size-4" />
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                className="size-8 text-success hover:text-success"
                onClick={() => onStart(forward)}
                aria-label={startLabel}
                title={startLabel}
                data-testid="port-forward-card-start"
              >
                <Play className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="size-8 hover:text-destructive"
              onClick={() => onDelete(forward)}
              aria-label={deleteLabel}
              title={deleteLabel}
              data-testid="port-forward-card-delete"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="flex items-start gap-2">
          <Globe className="size-4 text-muted-foreground mt-0.5 shrink-0" />
          <div className="min-w-0 space-y-0.5">
            <div className="text-xs text-muted-foreground">
              {t('portForward.local')}
            </div>
            <div className="font-mono text-sm break-all">
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
          <div className="min-w-0 space-y-0.5">
            <div className="text-xs text-muted-foreground">
              {forward.type === 'local'
                ? t('portForward.remote')
                : forward.type === 'remote'
                  ? t('portForward.local')
                  : 'SOCKS'}
            </div>
            <div className="font-mono text-sm break-all">
              {forward.type === 'dynamic'
                ? t('portForward.socksProxy')
                : `${forward.remoteHost}:${forward.remotePort}`}
            </div>
          </div>
        </div>

        {forward.hostName && (
          <div className="pt-2 border-t text-xs text-muted-foreground truncate">
            {t('portForward.via', { host: forward.hostName })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
