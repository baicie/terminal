/**
 * ShortcutsSettings
 *
 * 快捷键配置面板：
 * - 展示所有内置快捷键（可禁用）
 * - 支持重绑定快捷键（点击按键区域，进入录制模式）
 * - 冲突检测（与现有快捷键重复时提示）
 * - 重置为默认值
 */

import { Keyboard, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  shortcutsService,
  defaultShortcuts,
  type Shortcut,
  type ShortcutAction,
  builtInActions,
} from '@/service/shortcuts'

interface ConflictResult {
  hasConflict: boolean
  conflictingShortcut?: Shortcut
  conflictingAction?: ShortcutAction
}

function ShortcutRow({
  shortcut,
  isRecording,
  recordingId,
  onStartRecord,
  onStopRecord,
  onReset,
  t,
}: {
  shortcut: Shortcut
  isRecording: boolean
  recordingId: string | null
  onStartRecord: (id: string) => void
  onStopRecord: () => void
  onReset: () => void
  t: (key: string) => string
}) {
  const isThisRecording = isRecording && recordingId === shortcut.id

  const handleClick = () => {
    if (isThisRecording) {
      onStopRecord()
    } else {
      onStartRecord(shortcut.id)
    }
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
        {/* Key badge */}
        <button
          type="button"
          onClick={handleClick}
          className={`
            min-w-[80px] h-7 px-2 rounded border text-xs font-mono text-center transition-all
            ${isThisRecording
              ? 'border-primary bg-primary/10 text-primary animate-pulse'
              : 'border-border bg-muted/50 text-muted-foreground hover:border-primary/50'
            }
          `}
        >
          {isThisRecording ? t('settings.shortcuts.recording') : shortcut.keys.join(' + ')}
        </button>

        {/* Enable toggle */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => shortcutsService.updateShortcut(shortcut.id, { enabled: !shortcut.enabled })}
        >
          {shortcut.enabled ? t('settings.shortcuts.enabled') : t('settings.shortcuts.disabled')}
        </Button>

        {/* Reset */}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={onReset}
          title={t('settings.shortcuts.resetToDefault')}
        >
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>
    </div>
  )
}

export function ShortcutsSettings() {
  const { t } = useTranslation()
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(shortcutsService.getShortcuts())
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const recordingKeyRef = useRef<string[]>([])
  const cleanupRef = useRef<(() => void) | null>(null)

  const reload = useCallback(() => {
    setShortcuts([...shortcutsService.getShortcuts()])
  }, [])

  const checkConflict = useCallback(
    (keys: string[], excludeId: string): ConflictResult => {
      const all = shortcutsService.getShortcuts()
      for (const s of all) {
        if (s.id === excludeId || !s.enabled) continue
        if (keys.length === s.keys.length && keys.every((k, i) => k === s.keys[i])) {
          return {
            hasConflict: true,
            conflictingShortcut: s,
            conflictingAction: builtInActions.find(a => a.id === s.action),
          }
        }
      }
      return { hasConflict: false }
    },
    [],
  )

  const startRecord = useCallback(
    (id: string) => {
      if (cleanupRef.current) cleanupRef.current()
      setRecordingId(id)
      recordingKeyRef.current = []

      const onKeyDown = (e: KeyboardEvent) => {
        e.preventDefault()
        e.stopPropagation()

        // Escape cancels recording
        if (e.key === 'Escape') {
          setRecordingId(null)
          return
        }

        const parsed = shortcutsService.parseKeyboardEvent(e)
        if (parsed.length === 0) return

        recordingKeyRef.current = parsed

        const result = checkConflict(parsed, id)
        if (result.hasConflict && result.conflictingShortcut) {
          toast.warning(
            `${t('settings.shortcuts.conflictWith')} "${result.conflictingShortcut.name}"`,
          )
        }

        shortcutsService.updateShortcut(id, { keys: parsed })
        setRecordingId(null)
        reload()
      }

      window.addEventListener('keydown', onKeyDown, true)
      cleanupRef.current = () => window.removeEventListener('keydown', onKeyDown, true)
    },
    [checkConflict, reload, t],
  )

  const stopRecord = useCallback(() => {
    setRecordingId(null)
    if (cleanupRef.current) {
      cleanupRef.current()
      cleanupRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      if (cleanupRef.current) cleanupRef.current()
    }
  }, [])

  const handleReset = useCallback(
    (id: string) => {
      const defaultShortcut = defaultShortcuts.find((s: Shortcut) => s.id === id)
      if (defaultShortcut) {
        shortcutsService.updateShortcut(id, { keys: defaultShortcut.keys, enabled: defaultShortcut.enabled })
      }
      reload()
      toast.success(t('settings.shortcuts.resetSuccess'))
    },
    [reload, t],
  )

  const handleResetAll = () => {
    shortcutsService.resetToDefault()
    reload()
    toast.success(t('settings.shortcuts.resetSuccess'))
  }

  const filtered = shortcuts.filter(
    s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.keys.join(' ').toLowerCase().includes(searchQuery.toLowerCase()),
  )

  return (
    <div className="space-y-4 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Keyboard className="h-4 w-4" />
          <span>{t('settings.shortcuts.tip')}</span>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleResetAll}>
            <RotateCcw className="h-3 w-3 mr-1" />
            {t('settings.shortcuts.resetAll')}
          </Button>
        </div>
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder={t('settings.shortcuts.searchPlaceholder')}
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
      />

      {/* Recording hint */}
      {recordingId && (
        <div className="text-xs text-primary bg-primary/5 border border-primary/20 rounded-md px-3 py-2 animate-pulse">
          {t('settings.shortcuts.recordingHint')}
        </div>
      )}

      {/* Shortcuts list */}
      <div className="space-y-1 max-h-[400px] overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <div className="text-center py-8 text-sm text-muted-foreground">
            {t('settings.shortcuts.noResults')}
          </div>
        ) : (
          filtered.map(shortcut => (
            <ShortcutRow
              key={shortcut.id}
              shortcut={shortcut}
              isRecording={!!recordingId}
              recordingId={recordingId}
              onStartRecord={startRecord}
              onStopRecord={stopRecord}
              onReset={() => handleReset(shortcut.id)}
              t={t}
            />
          ))
        )}
      </div>
    </div>
  )
}
