'use client'

import { XIcon } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import * as React from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

function Dialog(props: React.ComponentProps<typeof DialogPrimitive.Root>) {
  // 受控且关闭时不挂载 Root：避免同页多个 Dialog 叠层（RemoveScroll / 遮罩）在 WebKit、Tauri 下吞掉点击导致无法关闭
  if (props.open === false) {
    return null
  }
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      data-tauri-drag-region="false"
      className={cn(
        // Same rule as the content: an overlay whose visibility depends on a CSS animation
        // that never advances leaves the whole app looking dead. The exit animation is
        // harmless (it runs after the dialog is already leaving) and stays.
        'fixed inset-0 z-[200] bg-black/50',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  overlayClassName,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  overlayClassName?: string
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-tauri-drag-region="false"
        /*
         * ## 入场动画不改变可见性 —— 只改变尺度
         *
         * 此前是 `animate-in fade-in-0 zoom-in-95`。`fade-in-0` 把
         * `--tw-enter-opacity` 设为 0，可见性完全交给 CSS 动画把它推回 1。
         *
         * 实测（真实 WKWebView，`e2e-03` 的 mkdir 用例）：
         *
         *     animation: "enter"  animationPlayState: "running"  opacity: "0"
         *
         * `getAnimations()` 报 `running`，属性值却永不推进 —— 无焦点或离屏的 WebView
         * 不为合成动画推进时间轴。对话框因此在 DOM 里、可聚焦、`elementFromPoint`
         * 命中的是它自己的按钮，而**用户看不到也点不到任何东西**。
         *
         * 这不是测试环境独有：后台窗口、从最小化恢复、前台切换的瞬间同样成立。
         * 一个「点了没反应」的新建文件夹对话框，是用户会当成崩溃的形态。
         *
         * 修法不是加 `opacity-100`（keyframes 会覆盖它，实测无效），而是**不让
         * 可见性成为动画的产物**：入场只保留缩放，opacity 不参与 keyframes。动画
         * 推进与否，对话框都是不透明的。
         */
        className={cn(
          'fixed top-[50%] left-[50%] z-[201] grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none sm:max-w-lg',
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            data-tauri-drag-region="false"
            className="absolute top-4 right-4 z-10 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-2 text-center sm:text-left', className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        'flex flex-col-reverse gap-2 sm:flex-row sm:justify-end',
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg leading-none font-semibold', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
