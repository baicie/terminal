import {
  Copy,
  Ellipsis,
  Eraser,
  Maximize2,
  Minimize2,
  PanelRight,
  Plug,
  RotateCw,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { TerminalPaneHeaderProps } from './terminal-pane-header-types'

interface TerminalPaneMenuProps {
  pane: TerminalPaneHeaderProps
  canReconnect: boolean
  canDisconnect: boolean
}

export function TerminalPaneMenu({
  pane,
  canReconnect,
  canDisconnect,
}: TerminalPaneMenuProps) {
  const { t } = useTranslation()
  const restoreFocusRef = useRef(true)

  const run = (action: () => void) => {
    restoreFocusRef.current = true
    action()
  }
  const openSearch = () => {
    restoreFocusRef.current = false
    pane.onSearch()
  }
  const copySsh = () => {
    if (!pane.host) return
    void navigator.clipboard.writeText(
      `ssh ${pane.host.username}@${pane.host.hostname} -p ${pane.host.port}`,
    )
    toast.success(t('common.copied'))
  }

  return (
    <DropdownMenu
      onOpenChange={open => {
        if (open) restoreFocusRef.current = true
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            'shrink-0 text-muted-foreground',
            pane.isMobile ? 'size-11' : 'size-8',
          )}
          aria-label={t('toolbar.more')}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-52"
        onCloseAutoFocus={event => {
          event.preventDefault()
          if (restoreFocusRef.current) {
            requestAnimationFrame(pane.onRequestFocus)
          }
          restoreFocusRef.current = true
        }}
      >
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={openSearch}>
            <Search />
            {t('terminal.search')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run(pane.onClear)}>
            <Eraser />
            {t('terminal.clear')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run(pane.onToggleTools)}>
            <PanelRight />
            {pane.toolsOpen ? t('terminal.hideTools') : t('terminal.showTools')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run(pane.onToggleFullscreen)}>
            {pane.fullscreen ? <Minimize2 /> : <Maximize2 />}
            {pane.fullscreen
              ? t('terminal.exitFullscreen')
              : t('terminal.fullscreen')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem
            disabled={pane.fontSize >= 32}
            onSelect={() => run(() => pane.onFontSizeChange(1))}
          >
            <ZoomIn />
            {t('terminal.zoomIn')}
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={pane.fontSize <= 8}
            onSelect={() => run(() => pane.onFontSizeChange(-1))}
          >
            <ZoomOut />
            {t('terminal.zoomOut')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => run(pane.onResetFontSize)}>
            <span className="w-4 text-center font-mono text-xs">
              {pane.fontSize}
            </span>
            {t('terminal.resetZoom')}
          </DropdownMenuItem>
        </DropdownMenuGroup>
        {pane.host ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => run(copySsh)}>
              <Copy />
              {t('hosts.copySsh')}
            </DropdownMenuItem>
          </>
        ) : null}
        {canReconnect || canDisconnect ? <DropdownMenuSeparator /> : null}
        {canReconnect ? (
          <DropdownMenuItem onSelect={() => run(pane.onReconnect!)}>
            <RotateCw />
            {t('common.retry')}
          </DropdownMenuItem>
        ) : null}
        {canDisconnect ? (
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => run(pane.onDisconnect!)}
          >
            <Plug />
            {t('terminal.disconnect')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
