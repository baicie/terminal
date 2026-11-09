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
import { Separator } from '@/components/ui/separator'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { PasteConfirmDialog } from './paste-confirm-dialog'
import type { PasteConfirmRequest } from './paste-confirm-dialog'
import { useSafePaste } from './use-safe-paste'

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
  const [pasteRequest, setPasteRequest] =
    React.useState<PasteConfirmRequest | null>(null)
  const pasteResolver = React.useRef<((accepted: boolean) => void) | null>(null)
  const askPasteConfirm = React.useCallback(
    (request: PasteConfirmRequest) =>
      new Promise<boolean>(resolve => {
        pasteResolver.current = resolve
        setPasteRequest(request)
      }),
    [],
  )
  const resolvePaste = React.useCallback((accepted: boolean) => {
    pasteResolver.current?.(accepted)
    pasteResolver.current = null
    setPasteRequest(null)
  }, [])

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

  // Same policy as the desktop menu: the mobile path must not be the one that
  // skips confirmation.
  const paste = useSafePaste(term, { confirm: askPasteConfirm })
  const handlePaste = async () => {
    onOpenChange(false)
    await paste()
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
    <>
    <PasteConfirmDialog request={pasteRequest} onResolve={resolvePaste} />
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
      >
        <SheetTitle className="sr-only">{t('common.actions')}</SheetTitle>
        <SheetDescription className="sr-only">
          {t('terminal.mobileMenuDescription')}
        </SheetDescription>
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
          <Separator className="my-1" />
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
    </>
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
