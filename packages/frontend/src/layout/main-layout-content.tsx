import { Outlet } from 'react-router-dom'
import AppSidebar from '@/components/app-sidebar'
import BottomNav from '@/components/bottom-nav'
import { SwipeBackIndicator } from '@/components/swipe-back-indicator'
import TopToolbar from '@/components/top-toolbar'
import { useIsMobile } from '@/hooks/use-breakpoint'
import { cn } from '@/lib/utils'
import { RouteTransition } from './route-transition'
import { TerminalByUrl } from './terminal-by-url'
import { useSidebarResize } from './use-sidebar-resize'
import { useSwipeBack } from './use-swipe-back'

interface MainLayoutContentProps {
  sidebarOpen: boolean
  sidebarWidth: number
  onToggleSidebar: () => void
  onSidebarWidthChange: (width: number) => void
}

export function MainLayoutContent({
  sidebarOpen,
  sidebarWidth,
  onToggleSidebar,
  onSidebarWidthChange,
}: MainLayoutContentProps) {
  const isMobile = useIsMobile()
  const { resizing, onResizeStart, onToggleCollapse } = useSidebarResize(
    sidebarWidth,
    onSidebarWidthChange,
  )
  const { swipeProgress, onSwipeStart, onSwipeMove, onSwipeEnd } =
    useSwipeBack()

  return (
    <div
      className="h-screen flex flex-col bg-background"
      onTouchStart={onSwipeStart}
      onTouchMove={onSwipeMove}
      onTouchEnd={onSwipeEnd}
    >
      <TopToolbar onToggleSidebar={onToggleSidebar} />

      <div className="flex-1 flex overflow-hidden min-h-0 relative">
        {swipeProgress > 0 && (
          <SwipeBackIndicator
            progress={swipeProgress}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-50 text-muted-foreground"
          />
        )}

        {sidebarOpen && (
          <>
            <AppSidebar
              onToggleCollapse={onToggleCollapse}
              width={sidebarWidth}
              resizing={resizing}
            />
            <div
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={sidebarWidth}
              tabIndex={0}
              className={cn(
                'w-[6px] shrink-0 cursor-col-resize flex items-center justify-center group outline-none select-none',
                'hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                resizing && 'cursor-col-resize bg-primary/20',
              )}
              onMouseDown={onResizeStart}
            >
              <div className="flex flex-col gap-1.5 py-8 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="size-1 rounded-full bg-muted-foreground/60" />
                <span className="size-1 rounded-full bg-muted-foreground/60" />
                <span className="size-1 rounded-full bg-muted-foreground/60" />
              </div>
            </div>
          </>
        )}

        <main
          className={cn(
            'flex-1 min-w-0 overflow-hidden bg-background',
            isMobile && 'mobile-safe-bottom',
          )}
        >
          <TerminalByUrl />
          <RouteTransition>
            <Outlet />
          </RouteTransition>
        </main>
      </div>

      {isMobile && <BottomNav />}
    </div>
  )
}
