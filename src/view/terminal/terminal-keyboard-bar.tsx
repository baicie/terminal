import {
  ChevronDown,
  ChevronUp,
  Keyboard,
  Maximize2,
  Minimize2,
  RotateCcw,
} from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet'
import { cn } from '@/lib/utils'

interface TerminalKeyboardBarProps {
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

const MODIFIER_KEYS = [
  { label: 'Esc', key: '\x1b', icon: null },
  { label: 'Tab', key: '\t', icon: null },
  { label: 'Ctrl', key: 'ctrl', icon: null, isModifier: true },
  { label: 'Alt', key: 'alt', icon: null, isModifier: true },
  { label: '↑', key: '\x1b[A', icon: ChevronUp },
  { label: '↓', key: '\x1b[B', icon: ChevronDown },
  { label: '→', key: '\x1b[C', icon: null },
  { label: '←', key: '\x1b[D', icon: null },
  { label: 'PgUp', key: '\x1b[5~', icon: null },
  { label: 'PgDn', key: '\x1b[6~', icon: null },
  { label: 'Home', key: '\x1b[H', icon: null },
  { label: 'End', key: '\x1b[F', icon: null },
]

const TerminalKeyboardBar: React.FC<TerminalKeyboardBarProps> = ({
  onSendKey,
  onFontSizeChange,
  fontSize = 14,
  isFullscreen,
  onToggleFullscreen,
  className,
}) => {
  const { t } = useTranslation()
  const [ctrlActive, setCtrlActive] = useState(false)
  const [altActive, setAltActive] = useState(false)
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const [altHeld, setAltHeld] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)

  const handleKey = (keyConfig: (typeof MODIFIER_KEYS)[0]) => {
    if (keyConfig.isModifier) return

    // Build the key sequence with modifiers
    let seq = ''
    if (ctrlHeld && !ctrlActive) seq += '\x1b' // Ctrl prefix is ESC
    if (altHeld) seq += '\x1b' // Alt prefix is ESC
    seq += keyConfig.key

    onSendKey(seq)

    // Auto-deactivate modifiers after sending
    if (ctrlHeld) { setCtrlHeld(false); setCtrlActive(false) }
    if (altHeld) { setAltHeld(false); setAltActive(false) }
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

        {/* Divider */}
        <div className="w-px h-5 bg-border/50 mx-0.5 shrink-0" />

        {/* Navigation keys */}
        {MODIFIER_KEYS.filter(k => !k.isModifier && ['↑', '↓', '→', '←'].includes(k.label)).map(kc => (
          <Button
            key={kc.label}
            variant="outline"
            size="sm"
            className="h-7 min-w-[36px] text-xs px-1 shrink-0 rounded-md font-mono"
            onClick={() => handleKey(kc)}
            title={kc.label}
          >
            {kc.icon ? <kc.icon className="size-3.5" /> : kc.label}
          </Button>
        ))}

        {/* Divider */}
        <div className="w-px h-5 bg-border/50 mx-0.5 shrink-0" />

        {/* Function keys */}
        {MODIFIER_KEYS.filter(k => !k.isModifier && ['Esc', 'Tab', 'PgUp', 'PgDn', 'Home', 'End'].includes(k.label)).map(kc => (
          <Button
            key={kc.label}
            variant="outline"
            size="sm"
            className="h-7 min-w-[36px] text-xs px-1 shrink-0 rounded-md font-mono"
            onClick={() => handleKey(kc)}
            title={kc.label}
          >
            {kc.label}
          </Button>
        ))}

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
            <span className="text-xs text-muted-foreground font-mono w-6 text-center">{fontSize}</span>
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
            {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
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

      {/* Help Sheet */}
      <Sheet open={helpOpen} onOpenChange={setHelpOpen}>
        <SheetContent side="bottom" className="h-[50dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
          <div className="flex flex-col gap-3 pt-2">
            <p className="px-2 text-sm font-semibold text-muted-foreground">Keyboard Shortcuts</p>

            <div className="grid grid-cols-2 gap-2 px-2">
              {[
                ['Esc', 'Cancel / Exit'],
                ['Tab', 'Auto-complete'],
                ['Ctrl+C', 'Interrupt'],
                ['Ctrl+D', 'End of file'],
                ['Ctrl+L', 'Clear screen'],
                ['Ctrl+Z', 'Suspend process'],
                ['↑ / ↓', 'Command history'],
                ['Ctrl+R', 'Search history'],
              ].map(([key, desc]) => (
                <div key={key} className="flex items-center gap-2 py-2 border-b border-border/40">
                  <kbd className="min-w-[48px] px-1.5 py-0.5 text-xs font-mono bg-secondary rounded text-center">{key}</kbd>
                  <span className="text-xs text-muted-foreground">{desc}</span>
                </div>
              ))}
            </div>

            <Button
              variant="outline"
              size="sm"
              className="mx-2 mt-1"
              onClick={() => onSendKey('\x1b[2J\x1b[H')}
            >
              <RotateCcw className="size-3.5 mr-1" data-icon="inline-start" />
              Clear terminal
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

export default TerminalKeyboardBar
