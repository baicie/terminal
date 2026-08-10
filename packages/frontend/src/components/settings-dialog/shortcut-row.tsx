import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { shortcutsService, type Shortcut } from '@/service/shortcuts'

interface ShortcutRowProps {
  shortcut: Shortcut
  isRecording: boolean
  recordingId: string | null
  onStartRecord: (id: string) => void
  onStopRecord: () => void
  onReset: () => void
  t: (key: string) => string
}

export function ShortcutRow({
  shortcut,
  isRecording,
  recordingId,
  onStartRecord,
  onStopRecord,
  onReset,
  t,
}: ShortcutRowProps) {
  const isThisRecording = isRecording && recordingId === shortcut.id
  const handleClick = () => {
    if (isThisRecording) onStopRecord()
    else onStartRecord(shortcut.id)
  }

  return (
    <div className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-accent/50 transition-colors group">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{shortcut.name}</div>
        {shortcut.description && (
          <div className="text-xs text-muted-foreground truncate">
            {shortcut.description}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 ml-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleClick}
          className={`min-w-[80px] h-7 px-2 rounded border text-xs font-mono text-center transition-all ${
            isThisRecording
              ? 'border-primary bg-primary/10 text-primary animate-pulse'
              : 'border-border bg-muted/50 text-muted-foreground hover:border-primary/50'
          }`}
        >
          {isThisRecording
            ? t('settings.shortcuts.recording')
            : shortcut.keys.join(' + ')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() =>
            shortcutsService.updateShortcut(shortcut.id, {
              enabled: !shortcut.enabled,
            })
          }
        >
          {shortcut.enabled
            ? t('settings.shortcuts.enabled')
            : t('settings.shortcuts.disabled')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={onReset}
          title={t('settings.shortcuts.resetToDefault')}
        >
          <RotateCcw />
        </Button>
      </div>
    </div>
  )
}
