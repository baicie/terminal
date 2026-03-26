/**
 * Settings CRUD 操作
 */
import { executeQuery, select } from './connection'
import type { AppSettings } from './types'

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
  const settings = await getSetting('app_settings', defaultSettings)
  return { ...defaultSettings, ...settings }
}

export async function saveAppSettings(
  settings: Partial<AppSettings>,
): Promise<void> {
  const current = await getAppSettings()
  const merged = { ...current, ...settings }
  await setSetting('app_settings', merged)
}
