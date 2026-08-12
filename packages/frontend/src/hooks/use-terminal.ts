/**
 * Binds xterm input/output to a tab-owned session.
 *
 * The session manager survives React view changes. This hook only owns the
 * current terminal surface and its input helpers.
 */
import type { Terminal as XTerminal } from '@baicie/xterm'
import { useEffect, useRef, useState } from 'react'
import { registerTerminalInput } from './terminal-input-registration'
import { formatIpcError } from './terminal-session-helpers'
import type {
  UseTerminalOptions,
  UseTerminalResult,
} from './terminal-session-types'
import {
  terminalSessionManager,
  type TerminalSessionBinding,
} from '@/features/terminal/services/terminal-session-manager'
import { terminalEmitter } from '@/service/terminal-emitter'

export type {
  ShellOutput,
  UseTerminalOptions,
  UseTerminalResult,
} from './terminal-session-types'
export { formatIpcError }

export function useTerminal(
  term: XTerminal | null,
  options: UseTerminalOptions,
): UseTerminalResult {
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<UseTerminalResult['status']>('idle')
  const [error, setError] = useState<string | null>(null)
  const bindingRef = useRef<TerminalSessionBinding | null>(null)
  const termRef = useRef<XTerminal | null>(null)
  const hostRef = useRef(options.host)
  const jumpHostRef = useRef(options.jumpHost)
  const onTabPressRef = useRef(options.onTabPress)

  termRef.current = term
  hostRef.current = options.host
  jumpHostRef.current = options.jumpHost
  onTabPressRef.current = options.onTabPress

  useEffect(() => {
    if (!term) return
    const sessionIdRef = { current: null as string | null }
    const binding = terminalSessionManager.attach(
      {
        tabId: options.tabId,
        tabType: options.tabType,
        host: hostRef.current,
        jumpHost: jumpHostRef.current,
        serialSessionId: options.serialSessionId,
        cols: options.cols ?? 80,
        rows: options.rows ?? 24,
      },
      {
        onOutput: data => termRef.current?.write(data),
        onState: snapshot => {
          sessionIdRef.current = snapshot.sessionId
          setSessionId(snapshot.sessionId)
          setStatus(snapshot.status)
          setError(snapshot.error)
        },
      },
    )
    bindingRef.current = binding

    const inputCleanup = registerTerminalInput({
      term,
      tabType: options.tabType,
      sessionIdRef,
      hostRef,
      onTabPressRef,
      write: binding.write,
      resize: binding.resize,
    })
    const removeEmitter = terminalEmitter.onWrite((data, targetTabId) => {
      if (!targetTabId || targetTabId === options.tabId) binding.write(data)
    })

    return () => {
      removeEmitter()
      for (const cleanup of inputCleanup) {
        try {
          const result = cleanup()
          if (result instanceof Promise) result.catch(() => {})
        } catch {
          // Input cleanup is best effort during tab switches and app shutdown.
        }
      }
      binding.dispose()
      if (bindingRef.current === binding) bindingRef.current = null
    }
  }, [
    term,
    options.tabId,
    options.tabType,
    options.host?.id,
    options.jumpHost?.id,
    options.serialSessionId,
    options.cols,
    options.rows,
  ])

  return {
    sessionId,
    status,
    error,
    write: data => bindingRef.current?.write(data),
    reconnect: () => bindingRef.current?.reconnect(),
    disconnect: () => bindingRef.current?.disconnect(),
  }
}
