/**
 * TerminalKeyboardBar Component
 * 移动端虚拟键盘栏
 */

import { Keyboard, Maximize2, Minimize2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { KeyboardKey } from './keyboard-bar-data'
import { KeyboardHelpSheet } from './keyboard-help-sheet'
import { KeyboardKeyButtons } from './keyboard-key-buttons'

export interface TerminalKeyboardBarProps {
  /** Called when a key sequence should be sent to the terminal */
  onSendKey: (key: string) => void
  /** Called when font size should change */
  onFontSizeChange?: (delta: number) => void
  /** Current font size */
  fontSize?: number
  /** Whether the terminal is in fullscreen mode */
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  className?: string
}

export function TerminalKeyboardBar({
  onSendKey,
  onFontSizeChange,
  fontSize = 14,
  isFullscreen,
  onToggleFullscreen,
  className,
}: TerminalKeyboardBarProps) {
  const [ctrlActive, setCtrlActive] = useState(false)
  const [altActive, setAltActive] = useState(false)
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const [altHeld, setAltHeld] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const handleKey = (keyConfig: KeyboardKey) => {
    if (keyConfig.isModifier) return

    // Build the key sequence with modifiers
    let seq = ''
    if (ctrlHeld && !ctrlActive) seq += '\x1b' // Ctrl prefix is ESC
    if (altHeld) seq += '\x1b' // Alt prefix is ESC
    seq += keyConfig.key

    onSendKey(seq)

    // Auto-deactivate modifiers after sending
    if (ctrlHeld) {
      setCtrlHeld(false)
      setCtrlActive(false)
    }
    if (altHeld) {
      setAltHeld(false)
      setAltActive(false)
    }
  }

  const toggleModifier = (mod: 'ctrl' | 'alt') => {
    if (mod === 'ctrl') {
      setCtrlHeld(p => !p)
      setCtrlActive(p => !p)
    } else {
      setAltHeld(p => !p)
      setAltActive(p => !p)
    }
  }

  return (
    <>
      <div
        className={cn(
          'flex items-center gap-0.5 px-2 py-1.5 overflow-x-auto',
          'bg-background/90 backdrop-blur-xl border-t border-border/60',
          'shrink-0 select-none',
          className,
        )}
        style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
      >
        {/* Modifier keys */}
        <Button
          variant={ctrlActive ? 'default' : 'ghost'}
          size="sm"
          className={cn(
            'h-7 min-w-[44px] text-xs px-1.5 shrink-0 rounded-md font-mono',
            ctrlActive && 'bg-primary text-primary-foreground',
          )}
          onClick={() => toggleModifier('ctrl')}
          title="Ctrl"
        >
          Ctrl
        </Button>
        <Button
          variant={altActive ? 'default' : 'ghost'}
          size="sm"
          className={cn(
            'h-7 min-w-[44px] text-xs px-1.5 shrink-0 rounded-md font-mono',
            altActive && 'bg-primary text-primary-foreground',
          )}
          onClick={() => toggleModifier('alt')}
          title="Alt / Option"
        >
          Alt
        </Button>

        <KeyboardKeyButtons onKey={handleKey} />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Font size */}
        {onFontSizeChange && (
          <div className="flex items-center gap-1 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onFontSizeChange(-1)}
              title="Decrease font size"
            >
              <span className="text-xs font-mono">A-</span>
            </Button>
            <span className="text-xs text-muted-foreground font-mono w-6 text-center">
              {fontSize}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onFontSizeChange(1)}
              title="Increase font size"
            >
              <span className="text-xs font-mono">A+</span>
            </Button>
          </div>
        )}

        {/* Clear screen */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs px-2 shrink-0 rounded-md"
          onClick={() => onSendKey('\x1b[2J\x1b[H')}
          title="Clear screen"
        >
          Clear
        </Button>

        {/* Fullscreen */}
        {onToggleFullscreen && (
          <Button
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            onClick={onToggleFullscreen}
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 className="size-3.5" />
            ) : (
              <Maximize2 className="size-3.5" />
            )}
          </Button>
        )}

        {/* Help */}
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={() => setHelpOpen(true)}
          title="Keyboard shortcuts"
        >
          <Keyboard className="size-3.5" />
        </Button>
      </div>

      <KeyboardHelpSheet
        open={helpOpen}
        onOpenChange={setHelpOpen}
        onClear={() => onSendKey('\x1b[2J\x1b[H')}
      />
    </>
  )
}

export default TerminalKeyboardBar
