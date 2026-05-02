import type { Host, Tab } from '@/types'
import { Copy, Plug, RotateCw, Server, Terminal as TerminalIcon, Usb } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toast } from '@/components/ui/sonner'
import { useWindowFocus } from '@/hooks/use-window-focus'
import { cn } from '@/lib/utils'

type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

interface SessionStatusBarProps {
  tab: Tab
  host?: Host
  status: ConnectionStatus
  onReconnect?: () => void
  onDisconnect?: () => void
}

const STATUS_META: Record<
  ConnectionStatus,
  { label: string; dot: string; text: string }
> = {
  idle: { label: 'Idle', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
  connecting: { label: 'Connecting…', dot: 'bg-warning animate-pulse', text: 'text-warning' },
  connected: { label: 'Connected', dot: 'bg-success', text: 'text-success' },
  disconnected: { label: 'Disconnected', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
  error: { label: 'Error', dot: 'bg-destructive', text: 'text-destructive' },
}

/** 终端会话上下文状态条：显示当前会话目标 + 状态 + 快捷操作 */
export const SessionStatusBar: React.FC<SessionStatusBarProps> = ({
  tab,
  host,
  status,
  onReconnect,
  onDisconnect,
}) => {
  const { t } = useTranslation()
  const meta = STATUS_META[status]
  const focused = useWindowFocus()

  const renderIcon = () => {
    if (tab.type === 'serial') return <Usb className="size-3.5 shrink-0" />
    if (tab.type === 'local') return <TerminalIcon className="size-3.5 shrink-0" />
    return <Server className="size-3.5 shrink-0" />
  }

  const renderTarget = () => {
    if (tab.type === 'serial') {
      const port = tab.serialConfig?.port?.split('/').pop() ?? tab.label
      return (
        <span className="font-mono text-xs">
          {port} · {tab.serialConfig?.baudRate ?? '?'} bps
        </span>
      )
    }
    if (tab.type === 'local') {
      return <span className="text-xs">{t('sidebar.localTerminal')}</span>
    }
    if (host) {
      return (
        <>
          <span className="text-xs font-medium truncate">{host.name}</span>
          <span className="text-xs text-muted-foreground/80 font-mono truncate">
            {host.username}@{host.hostname}:{host.port}
          </span>
        </>
      )
    }
    return <span className="text-xs">{tab.label}</span>
  }

  const handleCopy = () => {
    if (host) {
      void navigator.clipboard.writeText(
        `ssh ${host.username}@${host.hostname} -p ${host.port}`,
      )
      toast.success(t('common.copied'))
    }
  }

  return (
    <div
      className={cn(
        'flex h-7 shrink-0 items-center gap-2 border-b border-border/60 bg-background/60 backdrop-blur-sm px-3 text-foreground transition-opacity',
        !focused && 'opacity-60',
      )}
      title={focused ? undefined : t('terminal.windowUnfocused')}
    >
      {/* 目标信息 */}
      <div className="flex items-center gap-2 min-w-0 flex-1 text-muted-foreground">
        {renderIcon()}
        <div className="flex items-center gap-2 min-w-0 truncate">
          {renderTarget()}
        </div>
      </div>

      {/* 状态 */}
      <div className={cn('flex items-center gap-1.5 shrink-0', meta.text)}>
        <span className={cn('size-1.5 rounded-full', meta.dot)} />
        <span className="text-[11px] font-medium">{meta.label}</span>
      </div>

      {/* 快捷操作 */}
      <div className="flex items-center gap-0.5 shrink-0">
        {host && (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-foreground"
                onClick={handleCopy}
              >
                <Copy className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('hosts.copySsh')}</TooltipContent>
          </Tooltip>
        )}

        {onReconnect && status !== 'connected' && status !== 'connecting' && (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-foreground"
                onClick={onReconnect}
              >
                <RotateCw className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.retry')}</TooltipContent>
          </Tooltip>
        )}

        {onDisconnect && (status === 'connected' || status === 'connecting') && (
          <Tooltip delayDuration={200}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-6 text-muted-foreground hover:text-destructive"
                onClick={onDisconnect}
              >
                <Plug className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('common.close')}</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
