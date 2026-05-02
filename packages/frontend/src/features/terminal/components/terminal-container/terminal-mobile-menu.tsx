/**
 * Terminal Mobile Action Menu
 *
 * 移动端长按等价右键菜单。复用桌面端 ContextMenu 的复制/粘贴/全选/清屏/缩放
 * 等动作，使用 shadcn `Sheet` 从底部弹出。触发：长按终端容器 ≥500ms。
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
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent } from '@/components/ui/sheet'

interface TerminalMobileMenuProps {
  /** xterm 实例，用于读取选中、写入数据、清屏等 */
  term: XTerminal | null
  /** 字体放大缩小回调 */
  onFontSizeChange: (delta: number) => void
  /** 触发搜索浮层（移动端没必要，但保留可选） */
  onOpenSearch?: () => void
  /** 长按触发后的开关状态由父组件控制 */
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TerminalMobileMenu({
  term,
  onFontSizeChange,
  onOpenSearch,
  open,
  onOpenChange,
}: TerminalMobileMenuProps) {
  const { t } = useTranslation()

  const handleCopy = async () => {
    onOpenChange(false)
    if (!term) return
    const text = term.getSelection()
    if (!text) {
      toast.warning(t('terminal.copyEmpty'))
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('common.copied'))
    } catch {
      toast.error(t('terminal.copyEmpty'))
    }
  }

  const handlePaste = async () => {
    onOpenChange(false)
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
  }

  const handleSelectAll = () => {
    onOpenChange(false)
    term?.selectAll()
  }

  const handleClear = () => {
    onOpenChange(false)
    term?.clear()
  }

  const handleZoom = (delta: number) => () => {
    onOpenChange(false)
    onFontSizeChange(delta)
  }

  const handleSearch = () => {
    onOpenChange(false)
    onOpenSearch?.()
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
      >
        <div className="flex flex-col gap-1 p-2">
          <MobileItem
            icon={<ClipboardCopy className="size-5" />}
            label={t('terminal.copy')}
            onClick={handleCopy}
          />
          <MobileItem
            icon={<ClipboardPaste className="size-5" />}
            label={t('terminal.paste')}
            onClick={handlePaste}
          />
          <MobileItem
            icon={<ListChecks className="size-5" />}
            label={t('terminal.selectAll')}
            onClick={handleSelectAll}
          />
          <MobileItem
            icon={<Eraser className="size-5" />}
            label={t('terminal.clear')}
            onClick={handleClear}
          />
          {onOpenSearch && (
            <MobileItem
              icon={<Search className="size-5" />}
              label={t('terminal.search')}
              onClick={handleSearch}
            />
          )}
          <div className="h-px bg-border my-1" />
          <MobileItem
            icon={<ZoomIn className="size-5" />}
            label={t('terminal.zoomIn')}
            onClick={handleZoom(1)}
          />
          <MobileItem
            icon={<ZoomOut className="size-5" />}
            label={t('terminal.zoomOut')}
            onClick={handleZoom(-1)}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

function MobileItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className="justify-start h-12 gap-3 text-base font-normal"
    >
      <span className="text-muted-foreground">{icon}</span>
      {label}
    </Button>
  )
}

export default TerminalMobileMenu
