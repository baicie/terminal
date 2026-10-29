import { useEffect, useRef } from 'react'
import { loadTerminalSmokeRendererHeartbeat } from './terminal-smoke-renderer-heartbeat-contract'

export const TERMINAL_SMOKE_RENDERER_HEARTBEAT_INTERVAL_MS = 1_000

export function useTerminalSmokeRendererHeartbeat(enabled: boolean): void {
  const sequenceRef = useRef(0)
  const configPromiseRef = useRef<ReturnType<
    typeof loadTerminalSmokeRendererHeartbeat
  > | null>(null)

  useEffect(() => {
    if (!enabled) {
      configPromiseRef.current = null
      return
    }

    let active = true
    let intervalId: ReturnType<typeof setInterval> | null = null
    let report: (() => void) | null = null
    let heartbeatInFlight = false
    const abortController = new AbortController()

    const sendHeartbeat = async (endpoint: URL, token: string) => {
      if (!active || heartbeatInFlight) return
      heartbeatInFlight = true
      sequenceRef.current += 1
      const payload = {
        seq: sequenceRef.current,
        performanceNow: performance.now(),
        visibilityState:
          document.visibilityState === 'visible' ? 'visible' : 'hidden',
        hasFocus: document.hasFocus(),
        online: navigator.onLine,
      }
      const target = new URL(endpoint)
      target.searchParams.set('token', token)
      try {
        const response = await fetch(target, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify(payload),
          signal: abortController.signal,
        })
        if (!response.ok) {
          throw new Error(`Heartbeat endpoint returned HTTP ${response.status}`)
        }
      } catch {
        // Heartbeat diagnostics must never affect smoke execution.
      } finally {
        heartbeatInFlight = false
      }
    }

    const configPromise =
      configPromiseRef.current ?? loadTerminalSmokeRendererHeartbeat()
    configPromiseRef.current = configPromise
    void configPromise.catch(() => {
      if (configPromiseRef.current === configPromise)
        configPromiseRef.current = null
    })
    void configPromise
      .then(config => {
        if (!active || config === null) return
        let endpoint: URL
        try {
          endpoint = new URL(config.endpoint)
        } catch {
          return
        }
        report = () => {
          if (active) void sendHeartbeat(endpoint, config.token)
        }
        document.addEventListener('visibilitychange', report)
        window.addEventListener('focus', report)
        window.addEventListener('blur', report)
        report()
        intervalId = setInterval(
          report,
          TERMINAL_SMOKE_RENDERER_HEARTBEAT_INTERVAL_MS,
        )
      })
      .catch(() => {})

    return () => {
      active = false
      abortController.abort()
      if (intervalId !== null) clearInterval(intervalId)
      if (report !== null) {
        document.removeEventListener('visibilitychange', report)
        window.removeEventListener('focus', report)
        window.removeEventListener('blur', report)
      }
    }
  }, [enabled])
}
