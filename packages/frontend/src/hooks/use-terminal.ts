/**
 * Unified terminal data-flow hook.
 *
 * Input listeners and backend event listeners are registered before a shell
 * starts so initial output and early user input cannot be lost.
 */
import type { Terminal as XTerminal } from '@baicie/xterm'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useEffect, useRef, useState } from 'react'
import { registerTerminalInput } from './terminal-input-registration'
import {
  formatIpcError,
  sanitizeTerminalOutput,
  startTerminalShell,
} from './terminal-session-helpers'
import type {
  ShellOutput,
  UseTerminalOptions,
  UseTerminalResult,
} from './terminal-session-types'

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
  const {
    tabType,
    host,
    jumpHost,
    serialSessionId,
    cols: defaultCols = 80,
    rows: defaultRows = 24,
    onTabPress,
  } = options
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [status, setStatus] = useState<UseTerminalResult['status']>('idle')
  const [error, setError] = useState<string | null>(null)
  const termRef = useRef<XTerminal | null>(null)
  const sessionIdRef = useRef<string | null>(null)
  const hostRef = useRef(host)
  const jumpHostRef = useRef(jumpHost)
  const onTabPressRef = useRef(onTabPress)

  termRef.current = term
  hostRef.current = host
  jumpHostRef.current = jumpHost
  onTabPressRef.current = onTabPress

  useEffect(() => {
    if (!term) return

    let cancelled = false
    let started = false
    const cleanupFns = registerTerminalInput({
      term,
      tabType,
      sessionIdRef,
      hostRef,
      onTabPressRef,
    })
    const eventPrefix =
      tabType === 'local' ? 'local' : tabType === 'remote' ? 'ssh' : 'serial'

    const init = async () => {
      setStatus('connecting')
      setError(null)
      const listens: UnlistenFn[] = []
      const pendingData: ShellOutput[] = []
      let sessionIdReady = false

      try {
        const unlistenData = await listen<ShellOutput>(
          eventPrefix + '-data',
          event => {
            const output = event.payload
            if (!sessionIdReady) {
              pendingData.push(output)
              return
            }
            if (output.session_id !== sessionIdRef.current) return
            termRef.current?.write(sanitizeTerminalOutput(output.data))
          },
        )
        listens.push(unlistenData)

        const unlistenClose = await listen<string>(
          eventPrefix + '-close',
          event => {
            if (event.payload === sessionIdRef.current) {
              termRef.current?.write('\r\n[disconnected]\r\n')
              setStatus('disconnected')
            }
          },
        )
        listens.push(unlistenClose)

        if (tabType === 'remote') {
          const unlistenExit = await listen<[string, number]>(
            'ssh-exit',
            event => {
              const [exitSessionId, code] = event.payload
              if (exitSessionId === sessionIdRef.current) {
                termRef.current?.write(
                  '\r\n[process exited with code ' + code + ']\r\n',
                )
              }
            },
          )
          listens.push(unlistenExit)
        }

        if (cancelled) {
          listens.forEach(unlisten => unlisten())
          return
        }
        for (const unlisten of listens) cleanupFns.push(unlisten)

        const newSessionId = await startTerminalShell(
          tabType,
          hostRef.current,
          serialSessionId,
          defaultCols,
          defaultRows,
          jumpHostRef.current,
        )

        if (cancelled) {
          if (tabType === 'local' || tabType === 'remote') {
            void invoke('session_close', { sessionId: newSessionId }).catch(
              () => {},
            )
          }
          return
        }

        sessionIdRef.current = newSessionId
        sessionIdReady = true
        setSessionId(newSessionId)
        setStatus('connected')
        started = true

        for (const output of pendingData) {
          if (output.session_id === newSessionId) {
            termRef.current?.write(sanitizeTerminalOutput(output.data))
          }
        }
        pendingData.length = 0

        if (termRef.current && tabType !== 'serial') {
          const { cols, rows } = termRef.current
          void invoke('session_resize', {
            sessionId: newSessionId,
            cols,
            rows,
          }).catch(resizeError => {
            console.error(
              '[useTerminal] post-connect resize failed:',
              resizeError,
            )
          })
        }
      } catch (initError) {
        if (cancelled) return
        console.error('[useTerminal] init failed:', initError)
        listens.forEach(unlisten => unlisten())
        setError(formatIpcError(initError))
        setStatus('error')
      }
    }

    void init()
    return () => {
      cancelled = true
      for (const cleanup of cleanupFns) {
        try {
          const result = cleanup()
          if (result instanceof Promise) result.catch(() => {})
        } catch {
          // Cleanup is best effort.
        }
      }
      const activeSessionId = sessionIdRef.current
      if (
        activeSessionId &&
        started &&
        (tabType === 'local' || tabType === 'remote')
      ) {
        void invoke('session_close', {
          sessionId: activeSessionId,
        }).catch(() => {})
      }
      sessionIdRef.current = null
    }
  }, [
    term,
    tabType,
    host?.id,
    jumpHost?.id,
    serialSessionId,
    defaultCols,
    defaultRows,
  ])

  return { sessionId, status, error }
}
