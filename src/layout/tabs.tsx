import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { X, Columns, Rows } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/app'
import type { Tab } from '@/types'

/** 顶栏会话标签：仅展示已打开的终端/串口等标签 */
const MenuTabs: React.FC = () => {
  const { t } = useTranslation('demo')
  const navigate = useNavigate()
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    tabId: string
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const tabs = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const removeTab = useAppStore(s => s.removeTab)
  const setActiveTab = useAppStore(s => s.setActiveTab)
  const splitTab = useAppStore(s => s.splitTab)
  const closeSplit = useAppStore(s => s.closeSplit)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleContextMenu = (e: React.MouseEvent, tabId: string) => {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, tabId })
  }

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId)
    navigate(`/terminal?tab=${tabId}`)
  }

  const handleSplitHorizontal = () => {
    if (contextMenu) {
      splitTab(contextMenu.tabId, 'horizontal')
      setContextMenu(null)
    }
  }

  const handleSplitVertical = () => {
    if (contextMenu) {
      splitTab(contextMenu.tabId, 'vertical')
      setContextMenu(null)
    }
  }

  const handleCloseSplit = () => {
    if (contextMenu) {
      closeSplit(contextMenu.tabId)
      setContextMenu(null)
    }
  }

  const getTabStatus = (tab: Tab) => {
    if (tab.splitMode && tab.splitMode !== 'none') {
      return tab.splitMode === 'horizontal' ? '⬜' : '⬛'
    }
    return ''
  }

  if (tabs.length === 0) {
    return null
  }

  return (
    <div className="flex items-center gap-0.5 min-w-0 overflow-x-auto">
      {tabs.map((tab: Tab) => (
        <div
          key={tab.id}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 rounded-md text-sm transition-all duration-150 cursor-pointer shrink-0 max-w-[200px]',
            activeTabId === tab.id
              ? 'bg-secondary/80 text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40',
          )}
          style={
            activeTabId === tab.id
              ? { animation: 'fade-in 200ms ease-out both, slide-in-from-top 200ms ease-out both' }
              : undefined
          }
          onClick={() => handleTabClick(tab.id)}
          onContextMenu={e => handleContextMenu(e, tab.id)}
        >
          <span className="truncate">
            {tab.label} {getTabStatus(tab)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="size-5 opacity-60 hover:opacity-100 shrink-0"
            onClick={e => {
              e.stopPropagation()
              removeTab(tab.id)
            }}
          >
            <X className="size-3" />
          </Button>
        </div>
      ))}

      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 bg-popover border rounded-md shadow-lg py-1 min-w-[160px]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <Button
            variant="ghost"
            className="w-full justify-start px-3 py-1.5 h-auto text-sm gap-2"
            onClick={handleSplitVertical}
          >
            <Columns className="size-4" />
            {t('tabs.splitVertical')}
          </Button>
          <Button
            variant="ghost"
            className="w-full justify-start px-3 py-1.5 h-auto text-sm gap-2"
            onClick={handleSplitHorizontal}
          >
            <Rows className="size-4" />
            {t('tabs.splitHorizontal')}
          </Button>
          <Separator className="my-1" />
          <Button
            variant="ghost"
            className="w-full justify-start px-3 py-1.5 h-auto text-sm gap-2"
            onClick={handleCloseSplit}
          >
            <X className="size-4" />
            {t('tabs.closeSplit')}
          </Button>
        </div>
      )}
    </div>
  )
}

export default MenuTabs
