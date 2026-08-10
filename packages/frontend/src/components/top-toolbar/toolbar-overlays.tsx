import * as React from 'react'

const CommandPalette = React.lazy(() => import('@/components/command-palette'))
const HostDialog = React.lazy(() =>
  import('@/components/host-list/host-dialog').then(module => ({
    default: module.HostDialog,
  })),
)
const NotificationPanel = React.lazy(() =>
  import('@/components/notification-panel').then(module => ({
    default: module.NotificationPanel,
  })),
)

interface ToolbarOverlaysProps {
  commandPaletteOpen: boolean
  hostDialogOpen: boolean
  notificationPanelOpen: boolean
  onCommandPaletteOpenChange: (open: boolean) => void
  onHostDialogOpenChange: (open: boolean) => void
  onNotificationPanelOpenChange: (open: boolean) => void
}

export function ToolbarOverlays({
  commandPaletteOpen,
  hostDialogOpen,
  notificationPanelOpen,
  onCommandPaletteOpenChange,
  onHostDialogOpenChange,
  onNotificationPanelOpenChange,
}: ToolbarOverlaysProps) {
  return (
    <>
      {hostDialogOpen && (
        <React.Suspense fallback={null}>
          <HostDialog
            open={hostDialogOpen}
            onClose={() => onHostDialogOpenChange(false)}
          />
        </React.Suspense>
      )}
      {commandPaletteOpen && (
        <React.Suspense fallback={null}>
          <CommandPalette
            open={commandPaletteOpen}
            onClose={() => onCommandPaletteOpenChange(false)}
          />
        </React.Suspense>
      )}
      {notificationPanelOpen && (
        <React.Suspense fallback={null}>
          <NotificationPanel
            open={notificationPanelOpen}
            onOpenChange={onNotificationPanelOpenChange}
          />
        </React.Suspense>
      )}
    </>
  )
}
