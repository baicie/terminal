import type { Tab } from '@/types'
import { ArrowLeft, ArrowRight, Columns2, Rows2, X } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app'
import { getTabDisplayLabel } from '@/features/terminal/services/terminal-title'
import { TabConnectionStatus } from './tab-connection-status'

const MenuTabs: React.FC = () => {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const tabs = useAppStore(state => state.tabs)
  const activeTabId = useAppStore(state => state.activeTabId)
  const removeTab = useAppStore(state => state.removeTab)
  const setActiveTab = useAppStore(state => state.setActiveTab)
  const splitTab = useAppStore(state => state.splitTab)
  const closeSplit = useAppStore(state => state.closeSplit)
  const moveTab = useAppStore(state => state.moveTab)
  const activeRef = useRef<HTMLDivElement>(null)
  const tabListRef = useRef<HTMLDivElement>(null)
  const splitIds = tabs.map(tab => tab.splitId)

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId])

  if (tabs.length === 0) return null

  const activate = (tabId: string) => {
    setActiveTab(tabId)
    navigate('/terminal')
  }

  const onKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    const nextIndex =
      event.key === 'ArrowRight'
        ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + tabs.length) % tabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? tabs.length - 1
              : null
    if (nextIndex === null) return

    event.preventDefault()
    activate(tabs[nextIndex].id)
    const buttons =
      tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons?.[nextIndex]?.focus()
  }

  return (
    <div
      ref={tabListRef}
      role="tablist"
      aria-orientation="horizontal"
      aria-label={t('tabs.sessions')}
      className="flex min-w-0 items-center gap-0.5 overflow-x-auto overscroll-x-contain"
    >
      {tabs.map((tab, index) => {
        const active = activeTabId === tab.id
        const displayLabel = getTabDisplayLabel(tab)
        const split = Boolean(tab.splitId)
        const groupStart = split ? splitIds.indexOf(tab.splitId) : index
        const groupEnd = split ? splitIds.lastIndexOf(tab.splitId) : index
        const canMoveLeft = groupStart > 0
        const canMoveRight = groupEnd < tabs.length - 1
        const canSplit = !split && tab.type !== 'serial'

        return (
          <div
            key={tab.id}
            ref={active ? activeRef : undefined}
            role="presentation"
            className="group flex h-11 max-w-52 shrink-0 items-center sm:h-8"
          >
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  role="tab"
                  aria-selected={active}
                  aria-label={displayLabel}
                  tabIndex={active ? 0 : -1}
                  className={cn(
                    'h-11 min-w-11 flex-1 touch-manipulation justify-start gap-1 rounded-r-none px-2 font-normal sm:h-8 sm:min-w-0',
                    active
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                  )}
                  onClick={() => activate(tab.id)}
                  onKeyDown={event => onKeyDown(event, index)}
                  data-tauri-drag-region="false"
                >
                  <TabConnectionStatus status={tab.connectionStatus} />
                  <SplitStatus tab={tab} />
                  <span className="min-w-0 flex-1 truncate">{displayLabel}</span>
                </Button>
              </ContextMenuTrigger>
              <ContextMenuContent className="w-52">
                <ContextMenuGroup>
                  <ContextMenuItem
                    disabled={!canMoveLeft}
                    onSelect={() => moveTab(tab.id, 'left')}
                  >
                    <ArrowLeft />
                    {t('tabs.moveLeft')}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!canMoveRight}
                    onSelect={() => moveTab(tab.id, 'right')}
                  >
                    <ArrowRight />
                    {t('tabs.moveRight')}
                  </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuGroup>
                  <ContextMenuItem
                    disabled={!canSplit}
                    onSelect={() => {
                      if (canSplit) splitTab(tab.id, 'horizontal')
                    }}
                  >
                    <Columns2 />
                    {t('tabs.splitHorizontal')}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!canSplit}
                    onSelect={() => {
                      if (canSplit) splitTab(tab.id, 'vertical')
                    }}
                  >
                    <Rows2 />
                    {t('tabs.splitVertical')}
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!split}
                    onSelect={() => closeSplit(tab.id)}
                  >
                    <X />
                    {t('tabs.closeSplit')}
                  </ContextMenuItem>
                </ContextMenuGroup>
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onSelect={() => removeTab(tab.id)}
                >
                  <X />
                  {t('terminal.closeTab')}
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className={cn(
                'size-11 shrink-0 touch-manipulation rounded-l-none text-muted-foreground opacity-100 sm:size-8 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100',
                active && 'bg-secondary sm:opacity-100',
              )}
              aria-label={t('tabs.closeNamed', { name: displayLabel })}
              onClick={() => removeTab(tab.id)}
              data-tauri-drag-region="false"
            >
              <X />
            </Button>
          </div>
        )
      })}
    </div>
  )
}

function SplitStatus({ tab }: { tab: Tab }) {
  if (!tab.splitId || !tab.splitMode || tab.splitMode === 'none') return null
  const Icon = tab.splitMode === 'horizontal' ? Columns2 : Rows2
  return <Icon aria-hidden="true" className="shrink-0 text-muted-foreground" />
}
export default MenuTabs
