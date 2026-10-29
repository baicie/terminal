export const SIDEBAR_WIDTH_KEY = 'terminal.sidebar.width'
export const SIDEBAR_MIN = 64
export const SIDEBAR_MAX = 420
export const SIDEBAR_DEFAULT = 176

export function readSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY)
    if (!raw) return SIDEBAR_DEFAULT
    const width = Number.parseInt(raw, 10)
    if (Number.isNaN(width)) return SIDEBAR_DEFAULT
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, width))
  } catch {
    return SIDEBAR_DEFAULT
  }
}
