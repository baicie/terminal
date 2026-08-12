import type { Tab } from '@/types'
import type * as React from 'react'
import {
  Eraser,
  Maximize2,
  Minus,
  PanelRight,
  Plus,
  Search,
  Terminal,
  Minimize2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface TerminalToolbarProps {
  tab: Tab
  fontSize: number
  toolsOpen: boolean
  fullscreen: boolean
  onSearch: () => void
  onClear: () => void
  onToggleTools: () => void
  onFontSizeChange: (delta: number) => void
  onToggleFullscreen: () => void
}

export function TerminalToolbar({
  tab,
  fontSize,
  toolsOpen,
  fullscreen,
  onSearch,
  onClear,
  onToggleTools,
  onFontSizeChange,
  onToggleFullscreen,
}: TerminalToolbarProps) {
  const { t } = useTranslation()
  const Icon = Terminal

  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.07] bg-[#141820] px-3 text-[#a9b2c0]">
      <div className="flex min-w-0 items-center gap-2">
        <span className="flex size-5 items-center justify-center rounded bg-[#5eead4]/10 text-[#5eead4]">
          <Icon className="size-3.5" />
        </span>
        <span className="truncate font-mono text-[11px] text-[#d7dee8]">
          {tab.label}
        </span>
        <span className="hidden rounded border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.16em] text-[#718096] sm:inline-flex">
          {tab.type === 'remote' ? 'SSH' : tab.type}
        </span>
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <ToolbarButton label={t('terminal.search')} onClick={onSearch}>
          <Search />
        </ToolbarButton>
        <ToolbarButton label={t('terminal.clear')} onClick={onClear}>
          <Eraser />
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-white/10" />
        <ToolbarButton
          label={t('terminal.zoomOut')}
          onClick={() => onFontSizeChange(-1)}
          disabled={fontSize <= 8}
        >
          <Minus />
        </ToolbarButton>
        <span className="w-7 text-center font-mono text-[10px] text-[#718096]">
          {fontSize}
        </span>
        <ToolbarButton
          label={t('terminal.zoomIn')}
          onClick={() => onFontSizeChange(1)}
          disabled={fontSize >= 32}
        >
          <Plus />
        </ToolbarButton>
        <div className="mx-1 h-4 w-px bg-white/10" />
        <ToolbarButton
          label={toolsOpen ? t('terminal.hideTools') : t('terminal.showTools')}
          onClick={onToggleTools}
          active={toolsOpen}
        >
          <PanelRight />
        </ToolbarButton>
        <ToolbarButton
          label={
            fullscreen ? t('terminal.exitFullscreen') : t('terminal.fullscreen')
          }
          onClick={onToggleFullscreen}
        >
          {fullscreen ? <Minimize2 /> : <Maximize2 />}
        </ToolbarButton>
      </div>
    </div>
  )
}

function ToolbarButton({
  label,
  active = false,
  children,
  ...props
}: React.ComponentProps<typeof Button> & {
  label: string
  active?: boolean
}) {
  return (
    <Button
      {...props}
      type="button"
      title={label}
      variant="ghost"
      size="icon"
      aria-label={label}
      className={cn(
        'size-7 text-[#7f8da1] hover:bg-white/[0.07] hover:text-[#e8edf4]',
        active && 'bg-[#5eead4]/10 text-[#5eead4]',
      )}
    >
      {children}
    </Button>
  )
}
