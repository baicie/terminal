/**
 * Says out loud when a shortcut could not be saved.
 *
 * The service already recorded the failure and kept the binding in memory, but a
 * status only the console can see is not feedback: the user would close the
 * dialog believing the change survived, and find the old binding after a restart.
 * This banner is the visible half of that contract, with the retry the service
 * exposes.
 */

import { AlertTriangle, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { shortcutsService } from '@/service/shortcuts'
import type { ShortcutPersistState } from '@/service/shortcut-persist-state'

export function ShortcutPersistBanner() {
  const { t } = useTranslation()
  const [state, setState] = useState<ShortcutPersistState>(() =>
    shortcutsService.getPersistState(),
  )
  const [retrying, setRetrying] = useState(false)

  useEffect(() => shortcutsService.onPersistStateChange(setState), [])

  if (state.status !== 'failed') return null

  const retry = async () => {
    setRetrying(true)
    try {
      await shortcutsService.retryPersist()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm"
    >
      <AlertTriangle className="size-4 shrink-0 text-destructive" />
      <div className="flex-1 space-y-1">
        <p className="font-medium">{t('settings.shortcuts.saveFailed')}</p>
        <p className="text-xs text-muted-foreground break-words">
          {state.error ?? ''}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={retry}
        disabled={retrying}
        aria-busy={retrying}
      >
        <RotateCcw className="size-3 mr-1" />
        {t('settings.shortcuts.retrySave')}
      </Button>
    </div>
  )
}
