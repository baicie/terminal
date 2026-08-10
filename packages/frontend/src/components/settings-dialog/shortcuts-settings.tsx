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
import { Input } from '@/components/ui/input'
import {
  shortcutsService,
  defaultShortcuts,
  type Shortcut,
} from '@/service/shortcuts'
import { findShortcutConflict } from './shortcut-conflict'
import { ShortcutRow } from './shortcut-row'

export function ShortcutsSettings() {
  const { t } = useTranslation()
  const [shortcuts, setShortcuts] = useState<Shortcut[]>(
    shortcutsService.getShortcuts(),
  )
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const recordingKeyRef = useRef<string[]>([])
  const cleanupRef = useRef<(() => void) | null>(null)

  const reload = useCallback(() => {
    setShortcuts([...shortcutsService.getShortcuts()])
  }, [])

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

        const conflictingShortcut = findShortcutConflict(
          shortcutsService.getShortcuts(),
          parsed,
          id,
        )
        if (conflictingShortcut) {
          toast.warning(
            `${t('settings.shortcuts.conflictWith')} "${conflictingShortcut.name}"`,
          )
        }

        shortcutsService.updateShortcut(id, { keys: parsed })
        setRecordingId(null)
        reload()
      }

      window.addEventListener('keydown', onKeyDown, true)
      cleanupRef.current = () =>
        window.removeEventListener('keydown', onKeyDown, true)
    },
    [reload, t],
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
      const defaultShortcut = defaultShortcuts.find(
        (s: Shortcut) => s.id === id,
      )
      if (defaultShortcut) {
        shortcutsService.updateShortcut(id, {
          keys: defaultShortcut.keys,
          enabled: defaultShortcut.enabled,
        })
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

      <Input
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
