import { Copy, Minimize2, Minus, Settings, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useWindowControls } from './use-window-controls'
import { TitleBarWorkspaceSwitcher } from './workspace-switcher'

export type TitleBarStyle = 'macos' | 'windows' | 'linux'

interface CustomTitleBarProps {
  className?: string
  style?: TitleBarStyle
  title?: string
  onSettingsClick?: () => void
}

function detectPlatform(): TitleBarStyle {
  if (typeof navigator !== 'undefined') {
    const platform = navigator.platform.toLowerCase()
    if (platform.includes('mac') || platform.includes('darwin')) {
      return 'macos'
    }
    if (platform.includes('win') || platform.includes('windows')) {
      return 'windows'
    }
  }
  return 'linux'
}

export const CustomTitleBar: React.FC<CustomTitleBarProps> = ({
  className,
  style = detectPlatform(),
  title = 'Terminal',
  onSettingsClick,
}) => {
  const windowControls = useWindowControls()

  // macOS style - traffic lights on the left, title centered
  if (style === 'macos') {
    return (
      <div
        className={cn(
          'h-8 flex items-center justify-between bg-[#1e1e1e] select-none',
          'border-b border-[#333333]',
          className,
        )}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        {/* Left: Traffic lights + Workspace */}
        <div
          className="flex items-center gap-3 pl-3"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <div
            className="flex items-center gap-2"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-3 rounded-full bg-[#ff5f57] hover:bg-[#ff5f57]/80 border border-[#e0443b]"
              onClick={() => void windowControls.close()}
              aria-label="Close"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-3 rounded-full bg-[#febc2e] hover:bg-[#febc2e]/80 border border-[#e09a1f]"
              onClick={() => void windowControls.minimize()}
              aria-label="Minimize"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-3 rounded-full bg-[#28c840] hover:bg-[#28c840]/80 border border-[#1aab29]"
              onClick={() => void windowControls.toggleMaximize()}
              aria-label={windowControls.isMaximized ? 'Restore' : 'Maximize'}
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            />
          </div>
          <TitleBarWorkspaceSwitcher onSettingsClick={onSettingsClick} />
        </div>

        {/* Title */}
        <span className="text-xs text-[#cccccc] font-medium absolute left-1/2 -translate-x-1/2">
          {title}
        </span>

        {/* Right: Settings */}
        <div
          className="flex items-center gap-2 pr-3"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <Button
            variant="ghost"
            size="icon"
            className="size-6 text-[#cccccc] hover:bg-[#3c3c3c]"
            onClick={onSettingsClick}
            aria-label="Settings"
          >
            <Settings className="size-3.5" />
          </Button>
        </div>
      </div>
    )
  }

  // Windows/Linux style - title + workspace on left, settings + controls on right
  return (
    <div
      className={cn(
        'h-8 flex items-center justify-between bg-[#1e1e1e] select-none',
        'border-b border-[#333333]',
        className,
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: Title + Workspace */}
      <div
        className="flex items-center gap-3 pl-3"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <span className="text-xs text-[#cccccc] font-medium">{title}</span>
        <div className="h-4 w-px bg-[#333333]" />
        <TitleBarWorkspaceSwitcher onSettingsClick={onSettingsClick} />
      </div>

      {/* Right: Settings + Window controls */}
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            style === 'windows' ? 'size-10' : 'size-8',
            'rounded-none hover:bg-[#3c3c3c] text-[#cccccc]',
          )}
          onClick={onSettingsClick}
          aria-label="Settings"
        >
          <Settings className="size-4" />
        </Button>

        {style === 'linux' ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-none hover:bg-[#3c3c3c]"
              onClick={() => void windowControls.minimize()}
              aria-label="Minimize"
            >
              <Minus className="size-4 text-[#cccccc]" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-none hover:bg-[#3c3c3c]"
              onClick={() => void windowControls.toggleMaximize()}
              aria-label={windowControls.isMaximized ? 'Restore' : 'Maximize'}
            >
              {windowControls.isMaximized ? (
                <Minimize2 className="size-4 text-[#cccccc]" />
              ) : (
                <Copy className="size-3.5 text-[#cccccc]" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-none hover:bg-[#c42b1c] hover:text-white"
              onClick={() => void windowControls.close()}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-none hover:bg-[#3c3c3c]"
              onClick={() => void windowControls.minimize()}
              aria-label="Minimize"
            >
              <Minus className="size-4 text-[#cccccc]" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-none hover:bg-[#3c3c3c]"
              onClick={() => void windowControls.toggleMaximize()}
              aria-label={windowControls.isMaximized ? 'Restore' : 'Maximize'}
            >
              {windowControls.isMaximized ? (
                <Minimize2 className="size-4 text-[#cccccc]" />
              ) : (
                <Square className="size-3.5 text-[#cccccc]" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-none hover:bg-[#c42b1c] hover:text-white"
              onClick={() => void windowControls.close()}
              aria-label="Close"
            >
              <X className="size-4" />
            </Button>
          </>
        )}
      </div>
    </div>
  )
}

export default CustomTitleBar
