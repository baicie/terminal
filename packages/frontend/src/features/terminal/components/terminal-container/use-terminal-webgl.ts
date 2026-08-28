import { WebglAddon } from '@xterm/addon-webgl'
import type { Terminal as XTerminal } from '@baicie/xterm'
import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_WEBGL_RECOVERY_ATTEMPTS = 3

interface UseTerminalWebglOptions {
  term: XTerminal | null
  active: boolean
  ready: boolean
  refresh: () => void
}

export function useTerminalWebgl({
  term,
  active,
  ready,
  refresh,
}: UseTerminalWebglOptions) {
  const addonRef = useRef<WebglAddon | null>(null)
  const suspendedRef = useRef(false)
  const recoveryAttemptsRef = useRef(0)
  const activeRef = useRef(active)
  const [recoveryVersion, setRecoveryVersion] = useState(0)
  activeRef.current = active

  const dispose = useCallback(() => {
    addonRef.current?.dispose()
    addonRef.current = null
  }, [])

  const requestRecovery = useCallback(() => {
    if (
      !activeRef.current ||
      !suspendedRef.current ||
      document.visibilityState === 'hidden' ||
      recoveryAttemptsRef.current >= MAX_WEBGL_RECOVERY_ATTEMPTS
    ) {
      return
    }
    recoveryAttemptsRef.current++
    suspendedRef.current = false
    setRecoveryVersion(version => version + 1)
  }, [])

  useEffect(() => {
    if (!term || !active) {
      dispose()
      if (!active) {
        suspendedRef.current = false
        recoveryAttemptsRef.current = 0
      }
      return
    }
    if (addonRef.current || suspendedRef.current) return

    try {
      const addon = new WebglAddon()
      addonRef.current = addon
      addon.onContextLoss(() => {
        if (addonRef.current !== addon) return
        console.warn('[xterm] WebGL context lost; using default renderer')
        dispose()
        suspendedRef.current = true
        refresh()
      })
      term.loadAddon(addon)
      return () => {
        if (addonRef.current === addon) dispose()
      }
    } catch (error) {
      dispose()
      suspendedRef.current = true
      console.warn(
        '[xterm] WebGL addon unavailable, using default renderer:',
        error,
      )
    }
  }, [active, dispose, recoveryVersion, refresh, term])

  useEffect(() => {
    if (!ready) return
    window.addEventListener('focus', requestRecovery)
    document.addEventListener('visibilitychange', requestRecovery)
    return () => {
      window.removeEventListener('focus', requestRecovery)
      document.removeEventListener('visibilitychange', requestRecovery)
    }
  }, [ready, requestRecovery])
}
