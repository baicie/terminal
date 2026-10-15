import { useEffect } from 'react'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'

/**
 * Resume terminal sessions after the host wakes from sleep.
 *
 * Sleeping suspends timers and tears down the socket, so an automatic
 * reconnect spends its whole retry budget against a dead network and rests in
 * a retryable error state. The backend has already delivered its last error by
 * then, so no further event re-arms recovery. Firing on visibility change is
 * the point where the network is plausibly back, which is exactly when a fresh
 * attempt budget is worth spending.
 *
 * The browser's own connectivity event covers the case visibility cannot: a
 * machine that stays awake and focused through a Wi-Fi dropout. The link never
 * goes down as far as the OS is concerned — it keeps asserting "connected"
 * while traffic goes nowhere — so no visibility change ever fires and an
 * exhausted session would sit in its retryable error until the user noticed and
 * pressed reconnect.
 */
export function useTerminalHostWake(): void {
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        terminalSessionManager.handleHostWake()
      }
    }
    const onNetworkReturn = () => {
      terminalSessionManager.handleHostWake()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('focus', onVisibilityChange)
    window.addEventListener('online', onNetworkReturn)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('focus', onVisibilityChange)
      window.removeEventListener('online', onNetworkReturn)
    }
  }, [])
}
