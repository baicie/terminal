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
  TerminalInputDiagnosticEvent,
  TerminalOutputDiagnosticEvent,
  UseTerminalOptions,
  UseTerminalResult,
} from './terminal-session-types'
import {
  terminalSessionManager,
  type TerminalSessionBinding,
} from '@/features/terminal/services/terminal-session-manager'
import {
  TerminalOutputScheduler,
  type TerminalOutputSchedulerSnapshot,
} from '@/features/terminal/services/terminal-output-scheduler'
import type { TerminalSessionIoSnapshot } from '@/features/terminal/services/terminal-session-io'
import { terminalWriteBus } from '@/service/terminal-write-bus'
import { terminalOutputByteLength } from '@/features/terminal/services/terminal-output-chunks'

export const TERMINAL_RECONNECT_MODE_RESET =
  '\x1b[?1l\x1b>\x1b[?9l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l\x1b[?2004l\x1b[?47l\x1b[?1047l\x1b[?1049l\x1b[?25h'

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
  const [reconnectInfo, setReconnectInfo] = useState<{
    attempt?: number
    reason?: string
    nextRetryAt?: number
    retryable?: boolean
  }>({})
  const bindingRef = useRef<TerminalSessionBinding | null>(null)
  const outputSchedulerRef = useRef<TerminalOutputScheduler | null>(null)
  const outputErrorRef = useRef<string | null>(null)
  const termRef = useRef<XTerminal | null>(null)
  const hostRef = useRef(options.host)
  const jumpHostRef = useRef(options.jumpHost)
  const outputWriterRef = useRef(options.outputWriter)
  const onInputRef = useRef(options.onInput)
  const onOutputRef = useRef(options.onOutput)

  termRef.current = term
  hostRef.current = options.host
  jumpHostRef.current = options.jumpHost
  outputWriterRef.current = options.outputWriter
  onInputRef.current = options.onInput
  onOutputRef.current = options.onOutput

  useEffect(() => {
    if (!term || options.enabled === false) return
    outputErrorRef.current = null
    const sessionIdRef = { current: null as string | null }
    let binding: TerminalSessionBinding | null = null
    let outputFailed = false
    let previousStatus: UseTerminalResult['status'] = 'idle'
    const outputScheduler = new TerminalOutputScheduler(
      outputWriterRef.current ?? term,
      {
        onOverflow: outputError => {
          outputFailed = true
          outputErrorRef.current = outputError.message
          setError(outputError.message)
          binding?.disconnect()
        },
      },
    )
    outputSchedulerRef.current = outputScheduler
    binding = terminalSessionManager.attach(
      {
        tabId: options.tabId,
        workspaceId: options.workspaceId,
        tabType: options.tabType,
        host: hostRef.current,
        jumpHost: jumpHostRef.current,
        expectedHostKey: options.expectedHostKey,
        expectedJumpHostKey: options.expectedJumpHostKey,
        serialSessionId: options.serialSessionId,
        cols: options.cols ?? term.cols,
        rows: options.rows ?? term.rows,
      },
      {
        onOutput: (data, bytes, receipt) => {
          const diagnostic: TerminalOutputDiagnosticEvent = {
            data,
            bytes: terminalOutputByteLength(data),
            ...(bytes === undefined ? {} : { backendBytes: bytes }),
          }
          try {
            onOutputRef.current?.(diagnostic)
          } catch (error) {
            console.error(
              '[useTerminal] output diagnostic observer failed:',
              error,
            )
          }
          outputScheduler.enqueue(data, bytes, receipt)
        },
        onState: snapshot => {
          if (
            snapshot.status === 'reconnecting' &&
            previousStatus !== 'reconnecting'
          ) {
            outputScheduler.enqueue(TERMINAL_RECONNECT_MODE_RESET)
          }
          previousStatus = snapshot.status
          sessionIdRef.current = snapshot.sessionId
          setSessionId(snapshot.sessionId)
          setStatus(snapshot.status)
          setError(outputErrorRef.current ?? snapshot.error)
          setReconnectInfo({
            attempt: snapshot.attempt,
            reason: snapshot.reason,
            nextRetryAt: snapshot.nextRetryAt,
            retryable: snapshot.retryable,
          })
        },
      },
    )
    if (outputFailed) binding.disconnect()
    bindingRef.current = binding

    const inputCleanup = registerTerminalInput({
      term,
      tabType: options.tabType,
      sessionIdRef,
      write: binding.write,
      writeRaw: binding.writeRaw,
      resize: binding.resize,
      onInput: (event: TerminalInputDiagnosticEvent) =>
        onInputRef.current?.(event),
    })
    const removeEmitter = terminalWriteBus.onWrite((data, targetTabId) => {
      if (targetTabId === options.tabId) binding.write(data)
    })

    return () => {
      removeEmitter()
      binding?.dispose()
      outputScheduler.dispose()
      if (outputSchedulerRef.current === outputScheduler) {
        outputSchedulerRef.current = null
      }
      for (const cleanup of inputCleanup) {
        try {
          const result = cleanup()
          if (result instanceof Promise) result.catch(() => {})
        } catch {
          // Input cleanup is best effort during tab switches and app shutdown.
        }
      }
      if (bindingRef.current === binding) bindingRef.current = null
    }
  }, [
    term,
    options.tabId,
    options.workspaceId,
    options.tabType,
    options.enabled,
    options.expectedHostKey,
    options.expectedJumpHostKey,
    options.host?.id,
    options.host?.updatedAt,
    options.jumpHost?.id,
    options.jumpHost?.updatedAt,
    options.serialSessionId,
    options.cols,
    options.rows,
  ])

  return {
    sessionId,
    status,
    error,
    ...reconnectInfo,
    getInputDiagnostics: (): TerminalSessionIoSnapshot | null =>
      bindingRef.current?.getIoDiagnostics() ?? null,
    getOutputDiagnostics: (): TerminalOutputSchedulerSnapshot | null =>
      outputSchedulerRef.current?.snapshot() ?? null,
    write: data => bindingRef.current?.write(data),
    reconnect: () => {
      outputErrorRef.current = null
      outputSchedulerRef.current?.reset()
      bindingRef.current?.reconnect()
    },
    disconnect: () => bindingRef.current?.disconnect(),
  }
}
