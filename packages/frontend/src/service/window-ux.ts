/**
 * 窗口/桌面 UX 控制（仅 Tauri 环境生效，浏览器环境为 noop）
 */

function detectTauri(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI_INVOKE__' in window
}

/** 同步「关闭窗口最小化到托盘」开关到 Rust 后端 */
export async function syncCloseToTray(enabled: boolean): Promise<void> {
  if (!detectTauri()) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('set_close_to_tray', { enabled })
  } catch (e) {
    console.warn('[window-ux] syncCloseToTray failed', e)
  }
}

export async function showMainWindow(): Promise<void> {
  if (!detectTauri()) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('show_main_window')
  } catch (e) {
    console.warn('[window-ux] showMainWindow failed', e)
  }
}

export async function hideMainWindow(): Promise<void> {
  if (!detectTauri()) return
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('hide_main_window')
  } catch (e) {
    console.warn('[window-ux] hideMainWindow failed', e)
  }
}
