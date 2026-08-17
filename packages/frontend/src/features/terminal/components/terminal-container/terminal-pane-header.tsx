import type * as React from 'react'
import {
  Eraser,
  Maximize2,
  Minimize2,
  PanelRight,
  RotateCw,
  Search,
  Server,
  Terminal,
  Usb,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { TerminalPaneMenu } from './terminal-pane-menu'
import type {
  ConnectionStatus,
  TerminalPaneHeaderProps,
} from './terminal-pane-header-types'

const STATUS_STYLES: Record<ConnectionStatus, string> = {
  idle: 'bg-muted-foreground/50',
  connecting: 'bg-warning animate-pulse',
  connected: 'bg-success',
  disconnected: 'bg-muted-foreground/50',
  error: 'bg-destructive',
}

export function TerminalPaneHeader(props: TerminalPaneHeaderProps) {
  const { t } = useTranslation()
  const SessionIcon =
    props.tab.type === 'serial'
      ? Usb
      : props.tab.type === 'remote'
        ? Server
        : Terminal
  const target = getSessionTarget(props, t)
  const canReconnect = Boolean(
    props.onReconnect &&
    props.status !== 'connected' &&
    props.status !== 'connecting',
  )
  const canDisconnect = Boolean(
    props.onDisconnect &&
    (props.status === 'connected' || props.status === 'connecting'),
  )
  const runAndFocus = (action?: () => void) => {
    if (!action) return
    action()
    requestAnimationFrame(props.onRequestFocus)
  }

  return (
    <div
      className={cn(
        '@container flex shrink-0 items-center gap-2 border-b border-border/60 bg-background/95 px-2',
        props.isMobile ? 'h-11' : 'h-9',
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <SessionIcon
          aria-hidden="true"
          className="shrink-0 text-muted-foreground"
        />
        <div
          className="min-w-0 truncate text-xs"
          title={`${props.tab.label} · ${target}`}
        >
          <span className="font-medium text-foreground">{props.tab.label}</span>
          <span className="hidden text-muted-foreground @sm:inline">
            {' '}
            · {target}
          </span>
        </div>
      </div>

      <div
        className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
        title={props.errorMessage}
        role="status"
        aria-label={t(`terminal.status.${props.status}`)}
      >
        <span
          aria-hidden="true"
          className={cn('size-1.5 rounded-full', STATUS_STYLES[props.status])}
        />
        <span className="hidden @sm:inline">
          {t(`terminal.status.${props.status}`)}
        </span>
      </div>

      {!props.isMobile ? (
        <div className="hidden shrink-0 items-center gap-0.5 @md:flex">
          {canReconnect ? (
            <HeaderButton
              label={t('common.retry')}
              onClick={() => runAndFocus(props.onReconnect)}
            >
              <RotateCw />
            </HeaderButton>
          ) : null}
          <HeaderButton label={t('terminal.search')} onClick={props.onSearch}>
            <Search />
          </HeaderButton>
          <HeaderButton
            label={t('terminal.clear')}
            onClick={() => runAndFocus(props.onClear)}
          >
            <Eraser />
          </HeaderButton>
          <HeaderButton
            label={
              props.toolsOpen
                ? t('terminal.hideTools')
                : t('terminal.showTools')
            }
            onClick={() => runAndFocus(props.onToggleTools)}
            active={props.toolsOpen}
          >
            <PanelRight />
          </HeaderButton>
          <HeaderButton
            label={
              props.fullscreen
                ? t('terminal.exitFullscreen')
                : t('terminal.fullscreen')
            }
            onClick={() => runAndFocus(props.onToggleFullscreen)}
          >
            {props.fullscreen ? <Minimize2 /> : <Maximize2 />}
          </HeaderButton>
        </div>
      ) : null}

      <TerminalPaneMenu
        pane={props}
        canReconnect={canReconnect}
        canDisconnect={canDisconnect}
      />
    </div>
  )
}

function HeaderButton({
  label,
  active,
  children,
  ...props
}: React.ComponentProps<typeof Button> & { label: string; active?: boolean }) {
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>
        <Button
          {...props}
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          className={cn(
            'size-7 text-muted-foreground hover:text-foreground',
            active && 'bg-secondary text-foreground',
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function getSessionTarget(
  props: Pick<TerminalPaneHeaderProps, 'tab' | 'host'>,
  t: (key: string) => string,
): string {
  if (props.tab.type === 'serial') {
    const port =
      props.tab.serialConfig?.port?.split(/[/\\]/).pop() ?? props.tab.label
    return `${port} · ${props.tab.serialConfig?.baudRate ?? '?'} bps`
  }
  if (props.tab.type === 'local') return t('sidebar.localTerminal')
  if (props.host) {
    return `${props.host.username}@${props.host.hostname}:${props.host.port}`
  }
  return props.tab.label
}
