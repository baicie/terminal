/**
 * Turning built-in extensions on and off.
 *
 * The design requires that no optional extension runs by default, which makes this
 * panel the only way the snippet dock can ever appear. Without it the extension
 * shipped in a permanently-off state — implemented, tested, and unreachable.
 *
 * ## Why the list comes from the registry, not a literal
 *
 * An extension added later must show up here without editing this file. The panel
 * asks the registry what exists and renders a row per manifest; a hardcoded pair of
 * checkboxes is how a settings page silently stops covering what ships.
 *
 * ## Why enabling is a separate write
 *
 * `enabledExtensions` is persisted through `app_settings`, and the registry is told
 * at the same moment. Persisting without activating would show the switch on while
 * nothing runs; activating without persisting would lose it on restart.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import { getExtensionRegistry } from '@/features/extensions/use-extension-runtime'

interface ExtensionSettingsProps {
  /** Extension ids the user has enabled. */
  enabled: string[]
  onChange: (enabled: string[]) => void
}

export function ExtensionSettings({ enabled, onChange }: ExtensionSettingsProps) {
  const { t } = useTranslation()
  const [extensions, setExtensions] = useState(() => getExtensionRegistry().list())

  useEffect(() => {
    // Re-read on mount: a previous activation changed statuses, and the list is the
    // registry's, not a snapshot taken at module load.
    setExtensions(getExtensionRegistry().list())
  }, [])

  const toggle = (extensionId: string, on: boolean) => {
    const next = on
      ? [...new Set([...enabled, extensionId])]
      : enabled.filter(id => id !== extensionId)
    onChange(next)
  }

  if (extensions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t('settings.extensions.empty')}</p>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t('settings.extensions.description')}</p>
      <Separator />
      <ul className="space-y-3">
        {extensions.map(record => {
          const id = record.manifest.id
          /*
           * Cleanup problems surface here, and only when there are any.
           *
           * A deactivation that reported success while a disposer threw is a leak the
           * user cannot otherwise see: the switch reads "off", the dock is gone, and a
           * listener somewhere is still attached. This is the smallest place to say so —
           * the row for the extension it belongs to, no new panel and no plugin console.
           */
          const cleanupProblems = getExtensionRegistry().cleanupProblemsFor(id)
          return (
            <li key={id} className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <Label htmlFor={`extension-${id}`} className="text-sm font-medium">
                  {t(record.manifest.nameKey)}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t('settings.extensions.version', { version: record.manifest.version })}
                </p>
                {cleanupProblems.length > 0 ? (
                  <p className="text-xs text-destructive" role="status">
                    {t('settings.extensions.cleanupFailed', { count: cleanupProblems.length })}
                  </p>
                ) : null}
              </div>
              <Switch
                id={`extension-${id}`}
                checked={enabled.includes(id)}
                onCheckedChange={on => toggle(id, on)}
              />
            </li>
          )
        })}
      </ul>
    </div>
  )
}