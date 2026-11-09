/**
 * How the last shortcut write went.
 *
 * Its own module because the service, the settings dialog and the tests all need
 * the type, and keeping it beside the 300-line service pushed that file over the
 * project's size limit.
 */

/** How the last write went, so the UI can say so. */
export type ShortcutPersistStatus = 'idle' | 'pending' | 'saved' | 'failed'

export interface ShortcutPersistState {
  status: ShortcutPersistStatus
  error: string | null
}

