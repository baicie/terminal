const NEXT_FRAME_FALLBACK_MS = 100

export function waitForTerminalSmokeFrame(): Promise<void> {
  return new Promise(resolve => {
    let settled = false
    let frameId: number | null = null
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null
    const finish = () => {
      if (settled) return
      settled = true
      if (frameId !== null) cancelAnimationFrame(frameId)
      if (fallbackTimer !== null) clearTimeout(fallbackTimer)
      resolve()
    }
    frameId = requestAnimationFrame(finish)
    fallbackTimer = setTimeout(finish, NEXT_FRAME_FALLBACK_MS)
  })
}
