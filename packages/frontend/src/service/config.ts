/**
 * App config service — fetches from Tauri backend via command invoke.
 * Falls back gracefully when not in Tauri context.
 */
export interface AppConfig {
  version: string
  buildNumber?: string
  [key: string]: unknown
}

export async function getConfig(): Promise<AppConfig | null> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const config = await invoke<AppConfig>('get_app_config')
    return config
  } catch {
    return null
  }
}
