import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { KEYBOARD_KEYS, type KeyboardKey } from './keyboard-bar-data'

interface KeyboardKeyButtonsProps {
  onKey: (key: KeyboardKey) => void
}

function KeyButton({
  keyConfig,
  onKey,
}: KeyboardKeyButtonsProps & { keyConfig: KeyboardKey }) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-11 min-w-11 shrink-0 px-2 font-mono text-xs"
      onClick={() => onKey(keyConfig)}
      aria-label={keyConfig.label}
      title={keyConfig.label}
    >
      {keyConfig.icon ? <keyConfig.icon /> : keyConfig.label}
    </Button>
  )
}

export function KeyboardKeyButtons({ onKey }: KeyboardKeyButtonsProps) {
  const navigationKeys = KEYBOARD_KEYS.filter(key =>
    ['↑', '↓', '→', '←'].includes(key.label),
  )
  const functionKeys = KEYBOARD_KEYS.filter(key =>
    ['Esc', 'Tab', 'PgUp', 'PgDn', 'Home', 'End'].includes(key.label),
  )

  return (
    <>
      <Separator orientation="vertical" className="mx-0.5 h-5" />
      {navigationKeys.map(keyConfig => (
        <KeyButton key={keyConfig.label} keyConfig={keyConfig} onKey={onKey} />
      ))}
      <Separator orientation="vertical" className="mx-0.5 h-5" />
      {functionKeys.map(keyConfig => (
        <KeyButton key={keyConfig.label} keyConfig={keyConfig} onKey={onKey} />
      ))}
    </>
  )
}
