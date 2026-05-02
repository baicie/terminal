/**
 * 通知服务
 *
 * 三层 fallback：
 * 1. Tauri 原生通知（已安装应用，OS 级 toast）
 * 2. Browser Notification API（dev 环境）
 * 3. 永远写入 in-app `useNotificationStore`（侧栏铃铛 + 历史）
 *
 * 调用方只需 `notify({ title, body, type, ... })`，不必关心运行环境。
 *
 * 注意：原生通知只在 **窗口未聚焦** 时弹出（避免聚焦时双重提醒）；
 * in-app store 始终写入，用户可在通知中心回看。
 */
import type { NotificationType } from '@/store/notification'
import { useNotificationStore } from '@/store/notification'

interface NotificationPrefs {
  nativeNotifications: boolean
  notifyOnlyWhenUnfocused: boolean
}

let prefsCache: NotificationPrefs = {
  nativeNotifications: true,
  notifyOnlyWhenUnfocused: true,
}

/** 由 App 启动时调用，把 DB 里的偏好同步到 module-level cache */
export function applyNotificationPrefs(prefs: Partial<NotificationPrefs>) {
  prefsCache = {
    ...prefsCache,
    ...prefs,
  }
}

interface NotifyOptions {
  title: string
  body?: string
  type?: NotificationType
  /** 是否落地到 in-app 通知中心。默认 true */
  persistInApp?: boolean
  /** 是否尝试发原生 OS 通知。默认 true（仅在窗口失焦时实际弹出） */
  native?: boolean
  /** 强制无视失焦判断，立即弹原生通知（如严重错误）。默认 false */
  forceNative?: boolean
}

let nativeAllowed: boolean | null = null

function detectTauri(): boolean {
  if (typeof window === 'undefined') return false
  return '__TAURI_INTERNALS__' in window || '__TAURI_INVOKE__' in window
}

async function ensureNativePermission(): Promise<boolean> {
  if (nativeAllowed !== null) return nativeAllowed
  try {
    if (detectTauri()) {
      const mod = await import('@tauri-apps/plugin-notification')
      let granted = await mod.isPermissionGranted()
      if (!granted) {
        granted = (await mod.requestPermission()) === 'granted'
      }
      nativeAllowed = granted
      return granted
    }
    if (typeof Notification !== 'undefined') {
      if (Notification.permission === 'granted') {
        nativeAllowed = true
        return true
      }
      if (Notification.permission !== 'denied') {
        const res = await Notification.requestPermission()
        nativeAllowed = res === 'granted'
        return nativeAllowed
      }
    }
  } catch (e) {
    console.warn('[notifications] permission check failed', e)
  }
  nativeAllowed = false
  return false
}

async function isWindowFocused(): Promise<boolean> {
  try {
    if (detectTauri()) {
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke<boolean>('is_main_window_focused')
    }
  } catch {
    /* ignore, fallback to dom */
  }
  try {
    return typeof document !== 'undefined' ? document.hasFocus() : true
  } catch {
    return true
  }
}

async function emitNative(title: string, body?: string): Promise<void> {
  try {
    if (detectTauri()) {
      const mod = await import('@tauri-apps/plugin-notification')
      mod.sendNotification({ title, body })
      return
    }
    if (typeof Notification !== 'undefined') {
      // eslint-disable-next-line no-new
      new Notification(title, { body })
    }
  } catch (e) {
    console.warn('[notifications] emit failed', e)
  }
}

export async function notify(opts: NotifyOptions): Promise<void> {
  const {
    title,
    body,
    type = 'info',
    persistInApp = true,
    native = true,
    forceNative = false,
  } = opts

  if (persistInApp) {
    useNotificationStore.getState().addNotification({
      type,
      title,
      message: body,
      persistent: type === 'error' || type === 'warning',
    })
  }

  if (!native) return
  if (!prefsCache.nativeNotifications) return

  if (!forceNative && prefsCache.notifyOnlyWhenUnfocused) {
    const focused = await isWindowFocused()
    if (focused) return
  }

  if (await ensureNativePermission()) {
    await emitNative(title, body)
  }
}

/** 强制重置权限缓存（设置中关掉/开启原生通知时调用） */
export function resetNotificationPermissionCache() {
  nativeAllowed = null
}
