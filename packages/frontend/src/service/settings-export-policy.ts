/**
 * What may leave the device in an export, and what may not.
 *
 * Two separate problems hide behind "filter the settings":
 *
 * 1. `syncServiceToken` is a **credential for the user's own storage backend**. A
 *    backup file that carries it hands anyone holding the file write access to that
 *    backend, and a cloud upload that carries it puts the token inside the very
 *    bucket it unlocks. It must never be exported, uploaded or handed to a team
 *    package.
 * 2. The settings table stores *one* JSON object under `app_settings`, so removing
 *    the key `syncServiceToken` from the table does nothing — the token is a field
 *    inside that object's value. Filtering by table key alone would look correct
 *    and leak everything.
 *
 * So the rule is a **field-level allowlist for settings**, not a blocklist of known
 * bad names: a setting added tomorrow is excluded until someone adds it here. A
 * blocklist fails open, and failing open on a settings object means shipping a
 * credential.
 *
 * The trade-off is real and deliberate: a new *preference* also has to be added
 * here before it survives a backup. That is a small, visible cost paid at review
 * time, against a class of leak that is invisible at runtime.
 */

/**
 * Setting keys that may be exported.
 *
 * Every entry is a user preference that the user would expect to survive a restore.
 * Anything not listed — including any field a future build adds — is dropped.
 */
const EXPORTABLE_SETTING_KEYS = [
  'theme',
  'language',
  'fontSize',
  'fontFamily',
  'cursorStyle',
  'cursorBlink',
  'scrollback',
  'copyOnSelect',
  'pasteOnMiddleClick',
  'allowProposedApi',
  'dataStorageMode',
  'terminalTheme',
  'terminalThemeDark',
  'terminalThemeLight',
  'terminalThemeLightMigrated',
  'minimizeToTray',
  'nativeNotifications',
  'notifyOnlyWhenUnfocused',
  // Connection *preferences*: the endpoint and bucket name are how the user finds
  // their storage, not how they authenticate to it.
  'syncServiceType',
  'syncServiceEndpoint',
  'syncServiceUsername',
  'syncServiceBucket',
  'syncServiceRegion',
] as const

export type ExportableSettingKey = (typeof EXPORTABLE_SETTING_KEYS)[number]

/**
 * Settings that are credentials, listed explicitly so a reviewer can see the
 * decision and so a test can assert each one stays out.
 *
 * `syncServiceToken` authenticates to the user's storage backend.
 */
export const SENSITIVE_SETTING_KEYS = ['syncServiceToken'] as const

/**
 * The shape of the stored `app_settings` value, as far as export cares.
 *
 * Settings are stored as one JSON string under the `app_settings` table key, so
 * the filter has to reach inside it.
 */
export type StoredSettings = Record<string, unknown>

/**
 * Reduce an `app_settings` object to the exportable fields.
 *
 * Unknown fields are dropped, not passed through. A field that *is* a known
 * preference keeps its value even when that value is an empty string: "the user
 * cleared their username" is a setting, and dropping it would leave the target
 * device with whatever it had before.
 */
export function exportableAppSettings(value: unknown): StoredSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const source = value as StoredSettings
  const result: StoredSettings = {}
  for (const key of EXPORTABLE_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = source[key]
    }
  }
  return result
}

/**
 * Settings inside `app_settings` that exist and would be withheld.
 *
 * Reported to the caller so a restore can say "your storage token was not in this
 * backup" instead of silently leaving the target device unauthenticated.
 */
export function withheldSettingKeys(value: unknown): string[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return []
  }
  const source = value as StoredSettings
  return Object.keys(source).filter(
    key => !(EXPORTABLE_SETTING_KEYS as readonly string[]).includes(key),
  )
}

/**
 * The settings table key whose value is the JSON settings object.
 *
 * Special-cased because it is the one row whose value is not a scalar, and because
 * getting it wrong is exactly how the token escaped in the first place.
 */
export const APP_SETTINGS_KEY = 'app_settings'

/**
 * Other settings-table keys that are credentials in their own right.
 *
 * `team_settings` stores `apiToken`, which is a server credential. It lives inside
 * a JSON object for the same reason `app_settings` does, so it needs the same
 * treatment rather than a table-key blocklist.
 */
export const SENSITIVE_OBJECT_SETTING_KEYS = ['team_settings'] as const

/** Fields of `team_settings` that may be exported. */
const EXPORTABLE_TEAM_SETTING_KEYS = [
  'enabled',
  'mode',
  'endpoint',
  'autoSync',
  'syncInterval',
  'currentTeamId',
] as const

/** Fields of `team_settings` that are credentials. */
export const SENSITIVE_TEAM_SETTING_KEYS = ['apiToken'] as const

export function exportableTeamSettings(value: unknown): StoredSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {}
  }
  const source = value as StoredSettings
  const result: StoredSettings = {}
  for (const key of EXPORTABLE_TEAM_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      result[key] = source[key]
    }
  }
  return result
}

/**
 * Filter the settings table for export.
 *
 * A value that is a JSON object is filtered by its own allowlist; a scalar is
 * dropped unless it is known to be a preference. Unknown scalar keys are dropped:
 * a setting added by a future build must be reviewed before it travels.
 */
export function exportableSettings(
  rows: Array<{ key: string, value: string }>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const row of rows) {
    if (!row.key) continue
    if (row.key === APP_SETTINGS_KEY) {
      const parsed = parseJsonObject(row.value)
      result[row.key] = JSON.stringify(exportableAppSettings(parsed))
      continue
    }
    if ((SENSITIVE_OBJECT_SETTING_KEYS as readonly string[]).includes(row.key)) {
      const parsed = parseJsonObject(row.value)
      result[row.key] = JSON.stringify(exportableTeamSettings(parsed))
      continue
    }
    if ((SENSITIVE_SETTING_KEYS as readonly string[]).includes(row.key)) continue
    // Scalar settings are only exported when they are known preferences. The
    // shortcuts blob is a preference and is kept; anything else is withheld.
    if (!EXPORTABLE_SCALAR_SETTING_KEYS.has(row.key)) continue
    result[row.key] = row.value
  }
  return result
}

/** Scalar settings-table rows that are preferences, not credentials. */
const EXPORTABLE_SCALAR_SETTING_KEYS = new Set<string>([
  'terminal_shortcuts',
])

function parseJsonObject(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

/**
 * Decide what an imported settings map may write, without touching credentials.
 *
 * Three rules, and each one is a different defect:
 *
 * 1. A file may not write a setting this build treats as a credential. That is not
 *    only about old files — a crafted file can name `syncServiceToken` directly in
 *    the settings map, and the writer would persist it.
 * 2. Ordinary preferences **must** still restore. Dropping `app_settings` wholesale
 *    would make every restore reset the user's theme, font and language, which is
 *    the obvious way to "fix" a leak while breaking the feature.
 * 3. A credential the file *does* carry for a key this build keeps locally (a
 *    token, a team API token) is not written at all: the local value wins.
 *
 * The requirement this encodes: an import may never overwrite the token that the
 * target device is already using, and must never introduce one it did not have.
 */
export function importableSettings(
  settings: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(settings)) {
    if ((SENSITIVE_SETTING_KEYS as readonly string[]).includes(key)) continue
    if (key === APP_SETTINGS_KEY) {
      // The value may arrive as a JSON string (as stored) or as an object (as a
      // hand-written file has it). Either way only the allowlisted fields survive.
      const parsed = typeof value === 'string' ? parseJsonObject(value) : value
      const filtered = exportableAppSettings(parsed)
      if (Object.keys(filtered).length > 0) {
        result[key] = JSON.stringify(filtered)
      }
      continue
    }
    if ((SENSITIVE_OBJECT_SETTING_KEYS as readonly string[]).includes(key)) {
      const parsed = typeof value === 'string' ? parseJsonObject(value) : value
      const filtered = exportableTeamSettings(parsed)
      if (Object.keys(filtered).length > 0) {
        result[key] = JSON.stringify(filtered)
      }
      continue
    }
    if (!EXPORTABLE_SCALAR_SETTING_KEYS.has(key)) continue
    result[key] = value
  }
  return result
}

/**
 * Merge restored settings into the local ones, keeping local credentials.
 *
 * Called *after* the import transaction. The file's allowlisted preferences are
 * applied; every credential field is taken from the local object, so the import
 * cannot have moved it even if the database write above somehow carried one.
 */
export function mergeRestoredAppSettings(
  local: Record<string, unknown>,
  restored: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...local, ...restored }
  for (const key of SENSITIVE_SETTING_KEYS) {
    if (Object.prototype.hasOwnProperty.call(local, key)) {
      merged[key] = local[key]
    } else {
      delete merged[key]
    }
  }
  return merged
}
