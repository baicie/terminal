/**
 * 终端右键菜单
 *
 * 提供常用快捷操作：复制、粘贴、全选、清屏、缩放。
 * 桌面端 Web 浏览器的原生 contextmenu 默认不会被 xterm 拦截，
 * 这里包裹 xterm 容器并接管 onContextMenu 弹出 shadcn ContextMenu。
 */

import type { Terminal as XTerminal } from '@baicie/xterm'
import {
  ClipboardCopy,
  ClipboardPaste,
  Eraser,
  ListChecks,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'

interface TerminalContextMenuProps {
  /** xterm 实例，用于读取选中内容、写入数据 */
  term: XTerminal | null
  /** 字体放大/缩小的回调（沿用 container 的统一 setter） */
  onFontSizeChange: (delta: number) => void
  /** 触发搜索浮层显示 */
  onOpenSearch?: () => void
  /** 子节点：实际的 xterm 容器 div */
  children: React.ReactNode
}

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const modKey = isMac ? '⌘' : 'Ctrl'

export function TerminalContextMenu({
  term,
  onFontSizeChange,
  onOpenSearch,
  children,
}: TerminalContextMenuProps) {
  const { t } = useTranslation()

  const handleCopy = React.useCallback(async () => {
    if (!term) return
    const text = term.getSelection()
    if (!text) {
      toast.warning(t('terminal.copyEmpty'))
      return
    }
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      toast.error(t('terminal.copyEmpty'))
    }
  }, [term, t])

  const handlePaste = React.useCallback(async () => {
    if (!term) return
    try {
      const text = await navigator.clipboard.readText()
      if (!text) {
        toast.warning(t('terminal.pasteEmpty'))
        return
      }
      term.paste(text)
    } catch {
      toast.error(t('terminal.pasteEmpty'))
    }
  }, [term, t])

  const handleSelectAll = React.useCallback(() => {
    term?.selectAll()
  }, [term])

  const handleClear = React.useCallback(() => {
    term?.clear()
  }, [term])

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem onSelect={handleCopy}>
          <ClipboardCopy />
          {t('terminal.copy')}
          <ContextMenuShortcut>
            {isMac ? '⌘C' : `${modKey}+Shift+C`}
          </ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={handlePaste}>
          <ClipboardPaste />
          {t('terminal.paste')}
          <ContextMenuShortcut>
            {isMac ? '⌘V' : `${modKey}+Shift+V`}
          </ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={handleSelectAll}>
          <ListChecks />
          {t('terminal.selectAll')}
          <ContextMenuShortcut>{`${modKey}+A`}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={handleClear}>
          <Eraser />
          {t('terminal.clear')}
          <ContextMenuShortcut>{`${modKey}+K`}</ContextMenuShortcut>
        </ContextMenuItem>
        {onOpenSearch && (
          <ContextMenuItem onSelect={onOpenSearch}>
            <Search />
            {t('terminal.search')}
            <ContextMenuShortcut>{`${modKey}+F`}</ContextMenuShortcut>
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onFontSizeChange(1)}>
          <ZoomIn />
          {t('terminal.zoomIn')}
          <ContextMenuShortcut>{`${modKey}+`}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => onFontSizeChange(-1)}>
          <ZoomOut />
          {t('terminal.zoomOut')}
          <ContextMenuShortcut>{`${modKey}-`}</ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export default TerminalContextMenu
