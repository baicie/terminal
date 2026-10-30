/**
 * Settings CRUD 操作
 */
import { executeQuery, select } from './connection'
import type { AppSettings } from './types'

/** 旧版本浅色终端主题默认值，仅用于一次性迁移识别 */
const LEGACY_TERMINAL_THEME_LIGHT = 'solarized-light'

export const defaultSettings: AppSettings = {
  theme: 'dark',
  language: 'en',
  fontSize: 14,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  copyOnSelect: false,
  pasteOnMiddleClick: true,
  allowProposedApi: true,
  dataStorageMode: 'local',
  syncServiceType: 'webdav',
  syncServiceEndpoint: '',
  syncServiceUsername: '',
  syncServiceToken: '',
  syncServiceBucket: '',
  syncServiceRegion: '',
  terminalTheme: 'one-dark',
  terminalThemeDark: 'one-dark',
  terminalThemeLight: 'github-light',
  terminalThemeLightMigrated: false,
  minimizeToTray: false,
  nativeNotifications: true,
  notifyOnlyWhenUnfocused: true,
}

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const results = await select<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key],
  )
  if (results.length === 0) {
    return defaultValue
  }
  try {
    return JSON.parse(results[0].value) as T
  } catch {
    return defaultValue
  }
}

export async function setSetting<T>(key: string, value: T): Promise<void> {
  const jsonValue = JSON.stringify(value)
  await executeQuery(
    'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
    [key, jsonValue],
  )
}

export async function getAppSettings(): Promise<AppSettings> {
  const stored = await getSetting<Partial<AppSettings> | null>(
    'app_settings',
    null,
  )
  if (typeof stored !== 'object' || stored === null) {
    // 全新安装没有存量数据可迁移；在内存里即标记完成，首次保存会把它落库，
    // 否则用户在首次保存前后选定的 solarized-light 会被随后的迁移覆盖
    return { ...defaultSettings, terminalThemeLightMigrated: true }
  }
  const settings: AppSettings = { ...defaultSettings, ...stored }
  if (stored.terminalThemeLightMigrated) {
    return settings
  }
  // 一次性迁移：只有存量数据仍等于旧默认值时改写，之后标记位永久锁住用户选择
  const migrated: AppSettings = {
    ...settings,
    terminalThemeLight:
      settings.terminalThemeLight === LEGACY_TERMINAL_THEME_LIGHT
        ? 'github-light'
        : settings.terminalThemeLight,
    terminalThemeLightMigrated: true,
  }
  try {
    await setSetting('app_settings', migrated)
  } catch (e) {
    // 写回失败不阻断设置读取，下次启动按同样条件重试（幂等）
    console.warn('Failed to persist terminal theme migration:', e)
  }
  return migrated
}

export async function saveAppSettings(
  settings: Partial<AppSettings>,
): Promise<void> {
  const current = await getAppSettings()
  const merged = { ...current, ...settings }
  await setSetting('app_settings', merged)
}
