import { Button } from '@/components/ui/button'
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
      className="h-7 min-w-[36px] text-xs px-1 shrink-0 rounded-md font-mono"
      onClick={() => onKey(keyConfig)}
      title={keyConfig.label}
    >
      {keyConfig.icon ? (
        <keyConfig.icon className="size-3.5" />
      ) : (
        keyConfig.label
      )}
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
      <div className="w-px h-5 bg-border/50 mx-0.5 shrink-0" />
      {navigationKeys.map(keyConfig => (
        <KeyButton key={keyConfig.label} keyConfig={keyConfig} onKey={onKey} />
      ))}
      <div className="w-px h-5 bg-border/50 mx-0.5 shrink-0" />
      {functionKeys.map(keyConfig => (
        <KeyButton key={keyConfig.label} keyConfig={keyConfig} onKey={onKey} />
      ))}
    </>
  )
}
