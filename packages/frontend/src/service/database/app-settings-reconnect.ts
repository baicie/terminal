/**
 * F13 — the reconnect policy a user can choose, as stored settings.
 *
 * ## Why it is a separate interface rather than two more fields
 *
 * `types.ts` sits at its 300-line limit and holds every other setting. These two fields
 * come with more explanation than most (why absent is not the same as the default), so
 * they live next to each other rather than at the end of an unrelated interface.
 *
 * `AppSettings` extends this interface, so consumers import `AppSettings` and see the
 * fields without knowing where they are declared. Nothing at runtime changes: `app_settings`
 * is a JSON blob and optional keys need no migration.
 */
export interface ReconnectSettings {
  /**
   * F13 — initial backoff for automatic reconnect, in milliseconds.
   *
   * Absent means the shipped default (500). Only a value the user actually chose is
   * stored: persisting the default would freeze today's number into every existing
   * profile, so a later change to the default would silently not reach them.
   */
  reconnectBaseDelayMs?: number
  /**
   * F13 — how many times automatic reconnect will try before giving up.
   *
   * Absent means the shipped default (5). A non-positive or fractional value falls back
   * to that default inside `resolveReconnectPolicy` rather than failing startup: one bad
   * field must not stop the app from opening.
   */
  reconnectMaxAttempts?: number
}
