import { useEffect } from 'react'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'

/**
 * A sleeping host can leave a WKWebView visible and focused, so no browser
 * visibility event is guaranteed on resume. Keep this poll deliberately low
 * frequency and use wall-clock drift to detect a suspended timer.
 */
export const TERMINAL_HOST_WAKE_POLL_INTERVAL_MS = 15_000
export const TERMINAL_HOST_WAKE_DRIFT_THRESHOLD_MS =
  TERMINAL_HOST_WAKE_POLL_INTERVAL_MS + 1_000

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
    let lastPollAt = Date.now()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        terminalSessionManager.handleHostWake()
      }
    }
    const onNetworkReturn = () => {
      terminalSessionManager.handleHostWake()
    }
    const onPageResume = () => {
      terminalSessionManager.handleHostWake()
    }
    const pollTimer = window.setInterval(() => {
      const now = Date.now()
      // A backward wall-clock step (NTP correction, manual clock change) would
      // otherwise make the window negative and silence the drift check.
      const elapsed = Math.abs(now - lastPollAt)
      lastPollAt = now
      // A hidden window is throttled to >= 16s timer intervals by WKWebView and
      // the other browsers, which is indistinguishable from a suspended timer,
      // so judging drift here would fire on every single background poll. The
      // hidden case needs no drift check anyway: becoming visible again already
      // resumes sessions through the visibilitychange listener below.
      if (document.visibilityState !== 'visible') {
        return
      }
      if (elapsed >= TERMINAL_HOST_WAKE_DRIFT_THRESHOLD_MS) {
        terminalSessionManager.handleHostWake()
      }
    }, TERMINAL_HOST_WAKE_POLL_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)
    document.addEventListener('resume', onPageResume)
    window.addEventListener('focus', onVisibilityChange)
    window.addEventListener('online', onNetworkReturn)
    window.addEventListener('pageshow', onPageResume)
    return () => {
      window.clearInterval(pollTimer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
      document.removeEventListener('resume', onPageResume)
      window.removeEventListener('focus', onVisibilityChange)
      window.removeEventListener('online', onNetworkReturn)
      window.removeEventListener('pageshow', onPageResume)
    }
  }, [])
}
