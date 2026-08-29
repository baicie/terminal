import { useIsMobile } from '@/hooks/use-breakpoint'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet'

// ============================================================
// ResponsiveConfirm  — AlertDialog 的移动端替代
// ============================================================
interface ResponsiveConfirmProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  cancelText?: string
  confirmText?: string
  onCancel?: () => void
  onConfirm?: () => void
  destructive?: boolean
  loading?: boolean
}

function ResponsiveConfirm({
  open,
  onOpenChange,
  title,
  description,
  cancelText = 'Cancel',
  confirmText = 'Confirm',
  onCancel,
  onConfirm,
  destructive = false,
  loading = false,
}: ResponsiveConfirmProps) {
  const isMobile = useIsMobile()

  if (!open) {
    return null
  }

  if (isMobile) {
    return (
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="h-auto rounded-t-2xl pb-[env(safe-area-inset-bottom)]"
        >
          <div className="pt-2 space-y-4">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {description && (
                <p className="text-sm text-muted-foreground mt-1">{description}</p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <button
                className="w-full py-3 rounded-lg text-sm font-medium bg-destructive text-white hover:bg-destructive/90 transition-colors disabled:opacity-50"
                onClick={onConfirm}
                disabled={loading}
              >
                {confirmText}
              </button>
              <button
                className="w-full py-3 rounded-lg text-sm font-medium bg-secondary text-foreground hover:bg-secondary/80 transition-colors"
                onClick={() => { onCancel?.(); onOpenChange(false) }}
              >
                {cancelText}
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{cancelText}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={loading}
            className={destructive ? 'bg-destructive hover:bg-destructive/90' : undefined}
          >
            {confirmText}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

// ============================================================
// ResponsiveDialog  — Dialog / Sheet 响应式替身
//
// 移动端：渲染 SheetContent，header/footer 独立渲染（不包裹在 DialogHeader/DialogFooter 中）
// 桌面端：渲染 DialogContent，header/footer 保留 DialogHeader/DialogFooter 结构
//
// Props:
//   header  — DialogHeader 内容（移动端独立渲染，桌面端放入 DialogHeader）
//   footer   — DialogFooter 内容（移动端独立渲染，桌面端放入 DialogFooter）
//   children — 中间主体内容（两侧都通过 children 传递）
// ============================================================
interface ResponsiveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  header?: React.ReactNode
  footer?: React.ReactNode
  className?: string
  contentClassName?: string
  children?: React.ReactNode
  /** Mobile sheet height, e.g. '70dvh', '85dvh', '90dvh' */
  mobileHeight?: string
}

function ResponsiveDialog({
  open,
  onOpenChange,
  header,
  footer,
  className,
  contentClassName,
  children,
  mobileHeight = '90dvh',
}: ResponsiveDialogProps) {
  const isMobile = useIsMobile()

  if (!open) {
    return null
  }

  if (isMobile) {
    return (
      <Sheet open onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className={`rounded-t-2xl pb-[env(safe-area-inset-bottom)] flex flex-col ${className ?? ''}`}
          style={{ height: mobileHeight }}
        >
          {/* Header */}
          {header && (
            <div className="px-4 pt-2 pb-3 border-b border-border/60 shrink-0">
              {header}
            </div>
          )}
          {/* Body */}
          <div className={`flex-1 overflow-y-auto ${contentClassName ?? ''}`}>
            {children}
          </div>
          {/* Footer */}
          {footer && (
            <div className="px-4 pt-3 pb-2 border-t border-border/60 shrink-0">
              {footer}
            </div>
          )}
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className={className}>
        {header && <DialogHeader>{header}</DialogHeader>}
        <div className={contentClassName}>{children}</div>
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  )
}

export { ResponsiveConfirm, ResponsiveDialog }
