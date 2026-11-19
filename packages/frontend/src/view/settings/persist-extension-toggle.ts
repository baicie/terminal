/**
 * Persisting and applying an extension toggle.
 *
 * ## Why the toggle must do both, in one action
 *
 * Measured in a real WebView: the switch flipped, the registry activated, and the
 * extension was gone a few seconds later with the switch still rendering "on". The
 * toggle applied the new list but never wrote it, so `app_settings` still held the old
 * one — and anything that re-applied the *stored* list (a save from the settings page,
 * or the startup apply in `App`) put the registry back to the stale value.
 *
 * Applying without persisting also loses the choice on relaunch, which is the exact
 * failure `apply-enabled-extensions.ts` documents itself as existing to prevent.
 *
 * ## Why it lives outside the view
 *
 * It is a database write plus a registry call, not layout. Keeping it in its own module
 * is also what keeps `SettingsView` inside the 300-line view limit.
 */
import { saveAppSettings } from '@/service/database'
import { applyEnabledExtensions } from '@/features/extensions/apply-enabled-extensions'

export interface ExtensionToggleDeps {
  save: (settings: { enabledExtensions: string[] }) => Promise<void>
  apply: (enabledIds: readonly string[]) => Promise<void>
  /** Called after the write lands, so the view's saved snapshot matches the database. */
  onSaved: (enabledIds: string[]) => void
  onError: (error: unknown) => void
}

/**
 * Write the list, then make the registry match it.
 *
 * The write comes first: if it fails, nothing is applied, so the switch never shows a
 * state the database does not have. A failure is reported through `onError` rather
 * than thrown, because the view has to keep rendering either way.
 */
export async function persistAndApplyExtensionToggle(
  enabledIds: string[],
  deps: Partial<ExtensionToggleDeps> = {},
): Promise<void> {
  const save = deps.save ?? (async settings => saveAppSettings(settings))
  const apply = deps.apply ?? applyEnabledExtensions
  const onSaved = deps.onSaved ?? (() => undefined)
  const onError = deps.onError ?? (() => undefined)
  try {
    await save({ enabledExtensions: enabledIds })
    onSaved(enabledIds)
    await apply(enabledIds)
  } catch (error) {
    onError(error)
  }
}
