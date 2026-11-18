/**
 * Make the running extensions match a saved list.
 *
 * ## Why this is its own module
 *
 * It used to be a closure inside `SettingsView`, which meant it ran only while that
 * page was open. The list is persisted in `app_settings`; nothing applied it at
 * startup, so an extension a user enabled in one session was still off in the next
 * while its switch rendered "on" — the setting was stored and never read.
 *
 * Two callers now: the Settings page (on save and on toggle, so the switch does what
 * it looks like it does) and `App` at boot (so the previous session's choice survives
 * a restart).
 *
 * ## What it deliberately does not do
 *
 * It does not enable by default. `defaultEnabled: false` is a design rule — nothing
 * optional runs until the user says so — and this function's contract is "match the
 * list", which for an unlisted extension means *deactivate*.
 */
import { getExtensionRegistry } from './use-extension-runtime'

export async function applyEnabledExtensions(enabledIds: readonly string[]): Promise<void> {
  const registry = getExtensionRegistry()
  for (const record of registry.list()) {
    const id = record.manifest.id
    const shouldRun = enabledIds.includes(id)
    const running = record.status === 'active'
    if (shouldRun && !running) await registry.enable(id)
    else if (!shouldRun && running) await registry.deactivate(id)
  }
}
