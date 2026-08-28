import type { Terminal as XTerminal } from '@baicie/xterm'
import { invoke } from '@tauri-apps/api/core'
import type {
  TerminalInputDiagnosticEvent,
  UseTerminalOptions,
} from './terminal-session-types'

type Cleanup = () => void | Promise<void>

interface RegisterTerminalInputOptions {
  term: XTerminal
  tabType: UseTerminalOptions['tabType']
  sessionIdRef: { current: string | null }
  write?: (data: string) => void
  writeRaw?: (data: Uint8Array) => void
  resize?: (cols: number, rows: number) => void
  onInput?: (event: TerminalInputDiagnosticEvent) => void
}

export function registerTerminalInput({
  term,
  tabType,
  sessionIdRef,
  write,
  writeRaw,
  resize,
  onInput,
}: RegisterTerminalInputOptions): Cleanup[] {
  const cleanupFns: Cleanup[] = []
  const notifyInput = (event: TerminalInputDiagnosticEvent) => {
    try {
      onInput?.(event)
    } catch (error) {
      console.error('[useTerminal] input diagnostic observer failed:', error)
    }
  }
  const sendInput = (data: string) => {
    const sessionId = sessionIdRef.current
    if (write) {
      // The session manager owns the pre-connect FIFO. Do not drop bytes just
      // because the backend has not published its session id yet.
      write(data)
      return
    }
    if (!sessionId) return
    const command = tabType === 'serial' ? 'serial_write' : 'session_write'
    void invoke(command, { sessionId, data }).catch(error => {
      console.error('[useTerminal] write failed:', error)
    })
  }

  const onDataDisposable = term.onData((data: string) => {
    notifyInput({
      kind: 'text',
      data,
      bytes: new TextEncoder().encode(data).byteLength,
    })
    sendInput(data)
  })
  cleanupFns.push(() => onDataDisposable.dispose())
  const onBinaryDisposable = term.onBinary((data: string) => {
    const bytes = Uint8Array.from(data, char => char.charCodeAt(0) & 0xff)
    notifyInput({ kind: 'raw', data: bytes, bytes: bytes.byteLength })
    if (writeRaw) {
      writeRaw(bytes)
      return
    }
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    const command =
      tabType === 'serial' ? 'serial_write_raw' : 'session_write_raw'
    void invoke(command, { sessionId, data: bytes }).catch(error => {
      console.error('[useTerminal] raw write failed:', error)
    })
  })
  cleanupFns.push(() => onBinaryDisposable.dispose())

  if (tabType !== 'serial') {
    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      const sessionId = sessionIdRef.current
      if (resize) {
        resize(cols, rows)
      } else if (sessionId) {
        void invoke('session_resize', { sessionId, cols, rows }).catch(
          error => {
            console.error('[useTerminal] resize failed:', error)
          },
        )
      }
    })
    cleanupFns.push(() => onResizeDisposable.dispose())
  }
  return cleanupFns
}
