import {
  AArrowDown,
  AArrowUp,
  Eraser,
  Keyboard,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  CLEAR_TERMINAL_SEQUENCE,
  type KeyboardKey,
  useKeyboardModifiers,
} from './keyboard-bar-data'
import { KeyboardHelpSheet } from './keyboard-help-sheet'
import { KeyboardKeyButtons } from './keyboard-key-buttons'

export interface TerminalKeyboardBarProps {
  onSendKey: (key: string) => void
  onFontSizeChange?: (delta: number) => void
  fontSize?: number
  isFullscreen?: boolean
  onToggleFullscreen?: () => void
  onRequestFocus?: () => void
  className?: string
}

export function TerminalKeyboardBar({
  onSendKey,
  onFontSizeChange,
  fontSize = 14,
  isFullscreen,
  onToggleFullscreen,
  onRequestFocus,
  className,
}: TerminalKeyboardBarProps) {
  const { t } = useTranslation()
  const [helpOpen, setHelpOpen] = useState(false)
  const { modifiers, sendModifiedKey, toggleModifier } = useKeyboardModifiers(
    onSendKey,
    onRequestFocus,
  )
  const sendKey = (key: string) => {
    onSendKey(key)
    onRequestFocus?.()
  }
  const handleKey = (key: KeyboardKey) => {
    if (!key.isModifier) sendModifiedKey(key.key)
  }
  const handleHelpOpenChange = (open: boolean) => {
    setHelpOpen(open)
    if (!open) onRequestFocus?.()
  }

  return (
    <>
      <div
        className={cn(
          'flex shrink-0 select-none items-center gap-0.5 overflow-x-auto border-t border-border/60 bg-background/90 px-2 py-1.5 backdrop-blur-xl',
          className,
        )}
        style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
      >
        {(['ctrl', 'alt'] as const).map(modifier => (
          <Button
            key={modifier}
            type="button"
            variant={modifiers[modifier] ? 'default' : 'ghost'}
            size="sm"
            className="h-11 min-w-11 shrink-0 px-2 font-mono text-xs"
            aria-pressed={modifiers[modifier]}
            onClick={() => toggleModifier(modifier)}
            title={modifier === 'ctrl' ? 'Ctrl' : 'Alt'}
          >
            {modifier === 'ctrl' ? 'Ctrl' : 'Alt'}
          </Button>
        ))}

        <KeyboardKeyButtons onKey={handleKey} />
        <div className="flex-1" />

        {onFontSizeChange && (
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              onClick={() => {
                onFontSizeChange(-1)
                onRequestFocus?.()
              }}
              aria-label={t('terminal.decreaseFontSize')}
              title={t('terminal.decreaseFontSize')}
            >
              <AArrowDown data-icon="inline-start" />
            </Button>
            <span className="w-6 text-center font-mono text-xs text-muted-foreground">
              {fontSize}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              onClick={() => {
                onFontSizeChange(1)
                onRequestFocus?.()
              }}
              aria-label={t('terminal.increaseFontSize')}
              title={t('terminal.increaseFontSize')}
            >
              <AArrowUp data-icon="inline-start" />
            </Button>
          </div>
        )}

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-11 shrink-0 px-3 text-xs"
          onClick={() => sendKey(CLEAR_TERMINAL_SEQUENCE)}
          aria-label={t('terminal.clearScreen')}
          title={t('terminal.clearScreen')}
        >
          <Eraser data-icon="inline-start" />
          {t('terminal.clearScreen')}
        </Button>

        {onToggleFullscreen && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            onClick={() => {
              onToggleFullscreen()
              onRequestFocus?.()
            }}
            aria-label={t(
              isFullscreen ? 'terminal.exitFullscreen' : 'terminal.fullscreen',
            )}
            title={t(
              isFullscreen ? 'terminal.exitFullscreen' : 'terminal.fullscreen',
            )}
          >
            {isFullscreen ? (
              <Minimize2 data-icon="inline-start" />
            ) : (
              <Maximize2 data-icon="inline-start" />
            )}
          </Button>
        )}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-11 shrink-0"
          onClick={() => setHelpOpen(true)}
          aria-label={t('shortcuts.title')}
          title={t('shortcuts.title')}
        >
          <Keyboard data-icon="inline-start" />
        </Button>
      </div>

      <KeyboardHelpSheet
        open={helpOpen}
        onOpenChange={handleHelpOpenChange}
        onClear={() => onSendKey(CLEAR_TERMINAL_SEQUENCE)}
      />
    </>
  )
}

export default TerminalKeyboardBar
