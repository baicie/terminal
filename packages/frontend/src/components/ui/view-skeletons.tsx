import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

// ============================================================
// HostCardSkeleton — 主机卡片骨架屏
// ============================================================
interface HostCardSkeletonProps {
  count?: number
  className?: string
}

export function HostCardSkeleton({ count = 6, className }: HostCardSkeletonProps) {
  return (
    <div className={cn('grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-6', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-4 rounded-xl border border-border/50 bg-card/80 space-y-3"
        >
          <div className="flex items-start gap-3">
            <Skeleton className="size-10 rounded-lg shrink-0" />
            <div className="flex-1 space-y-2 pt-1">
              <Skeleton className="h-4 w-3/4 rounded" />
              <Skeleton className="h-3 w-1/2 rounded" />
              <Skeleton className="h-3 w-2/3 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// Mobile single-column skeleton
export function HostListSkeleton({ count = 8, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-2 px-3 pb-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-3.5 rounded-xl border border-border/50 bg-card/80"
        >
          <Skeleton className="size-6 rounded shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2 rounded" />
            <Skeleton className="h-3 w-3/4 rounded" />
          </div>
          <Skeleton className="h-4 w-4 rounded-full" />
        </div>
      ))}
    </div>
  )
}

// ============================================================
// KeyCardSkeleton — Keychain 列表骨架屏
// ============================================================
export function KeyListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="divide-y">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 flex items-start gap-3">
          <Skeleton className="size-9 rounded-md shrink-0" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-4 w-2/3 rounded" />
            <Skeleton className="h-3 w-1/3 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================
// SnippetRowSkeleton — Snippets 表格骨架屏
// ============================================================
export function SnippetRowSkeleton({ count = 6 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 px-4 py-3 border-b border-border/40 last:border-0"
        >
          <Skeleton className="size-8 rounded-md shrink-0" />
          <div className="flex-1 min-w-0 space-y-1.5">
            <Skeleton className="h-3.5 w-1/3 rounded" />
            <Skeleton className="h-3 w-1/2 rounded" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full shrink-0" />
          <div className="flex items-center gap-1 shrink-0">
            <Skeleton className="size-7 rounded-md" />
            <Skeleton className="size-7 rounded-md" />
          </div>
        </div>
      ))}
    </>
  )
}

// ============================================================
// PortForwardCardSkeleton — 端口转发卡片骨架屏
// ============================================================
export function PortForwardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="p-4 rounded-xl border border-border/50 bg-card/80 space-y-3"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Skeleton className="size-8 rounded-md shrink-0" />
              <Skeleton className="h-4 w-24 rounded" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-28 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  )
}

// ============================================================
// ToolbarSkeleton — 工具栏骨架屏（移动端用）
// ============================================================
export function ToolbarSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-2 px-3 py-2.5 border-b border-border/60 bg-background', className)}>
      <Skeleton className="h-10 flex-1 rounded-lg" />
      <Skeleton className="h-10 w-20 rounded-lg shrink-0" />
      <Skeleton className="h-8 w-8 rounded-md shrink-0" />
    </div>
  )
}
