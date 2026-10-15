import { Terminal as TerminalComponent } from '@baicie/xterm'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTerminal } from '@/hooks/use-terminal'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import {
  createRawInputProbeCommand,
  RawInputProbeParser,
  type RawInputProbeCase,
  type RawInputProbeConfig,
  publishRawInputProbeResult,
} from './protocol'
import '@baicie/xterm/css/xterm.css'

const TAB_ID = 'terminal-raw-input-probe'
const WORKSPACE_ID = 'terminal-raw-input-probe'
const TIMEOUT_MS = 15_000

function dispatchMouse(term: TerminalComponent, col: number, row: number): void {
  const target = term.screenElement ?? term.element
  if (!target) throw new Error('Raw input probe xterm element is unavailable')
  const rect = target.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error('Raw input probe xterm geometry is unavailable')
  }
  const cellWidth = rect.width / term.cols
  const cellHeight = rect.height / term.rows
  target.dispatchEvent(
    new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: rect.left + col * cellWidth + 1,
      clientY: rect.top + row * cellHeight + 1,
    }),
  )
}

function triggerCase(term: TerminalComponent, caseName: RawInputProbeCase): void {
  if (caseName === 'sgr-mouse') {
    term.write('\u001b[?1000h\u001b[?1006h', () => dispatchMouse(term, 2, 3))
    return
  }
  if (caseName === 'bracketed-paste') {
    term.write('\u001b[?2004h', () => term.paste('first\nsecond'))
    return
  }
  term.write('\u001b[?1000h', () => dispatchMouse(term, 96, 30))
}

export default function RawInputProbeRoot({
  config,
}: {
  config: RawInputProbeConfig
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const parserRef = useRef<RawInputProbeParser | null>(null)
  const nonceRef = useRef(`raw_${Date.now().toString(36)}`)
  const writeRef = useRef<(data: string) => void>(() => {})
  const inputEventsRef = useRef<Array<{ kind: string; bytes: number; dataHex: string }>>([])
  const inputIoSnapshotRef = useRef<unknown>(null)
  const sentCommandRef = useRef(false)
  const finishedRef = useRef(false)
  const [startedAt] = useState(() => performance.now())
  const [term] = useState(
    () =>
      new TerminalComponent({
        cols: 100,
        rows: 40,
        cursorBlink: false,
        allowProposedApi: true,
      }),
  )

  const publishFailure = useCallback(
    (message: string) => {
      if (finishedRef.current) return
      finishedRef.current = true
      void publishRawInputProbeResult({
        ok: false,
        caseName: config.caseName,
        expectedHex: config.expectedHex,
        receivedHex: '00',
        durationMs: Math.max(1, Math.ceil(performance.now() - startedAt)),
        error: `${message}; input events=${JSON.stringify(inputEventsRef.current)}; io=${JSON.stringify(inputIoSnapshotRef.current)}`,
      }).catch(error => console.error('Failed to publish raw input probe failure:', error))
    },
    [config.caseName, config.expectedHex, startedAt],
  )

  const { status, write, getInputDiagnostics } = useTerminal(term, {
    tabId: TAB_ID,
    workspaceId: WORKSPACE_ID,
    tabType: 'local',
    onOutput: event => {
      const parser = parserRef.current
      if (!parser || finishedRef.current) return
      try {
        for (const protocolEvent of parser.push(event.data)) {
          if (protocolEvent.kind === 'ready') {
            window.setTimeout(() => {
              if (!finishedRef.current) triggerCase(term, config.caseName)
            }, 250)
          } else {
            finishedRef.current = true
            const ok = protocolEvent.hex === config.expectedHex
            void publishRawInputProbeResult({
              ok,
              caseName: config.caseName,
              expectedHex: config.expectedHex,
              receivedHex: protocolEvent.hex,
              durationMs: Math.max(1, Math.ceil(performance.now() - startedAt)),
              error: ok
                ? null
                : `Raw input probe received mismatched bytes (received=${protocolEvent.hex}); input events=${JSON.stringify(inputEventsRef.current)}; io=${JSON.stringify(inputIoSnapshotRef.current)}`,
            }).catch(error => console.error('Failed to publish raw input probe result:', error))
          }
        }
      } catch (error) {
        publishFailure(error instanceof Error ? error.message : String(error))
      }
    },
    onInput: event => {
      const bytes =
        typeof event.data === 'string'
          ? new TextEncoder().encode(event.data)
          : event.data
      inputEventsRef.current.push({
        kind: event.kind,
        bytes: event.bytes,
        dataHex: Array.from(bytes)
          .map(byte => byte.toString(16).padStart(2, '0'))
          .join(''),
      })
      inputIoSnapshotRef.current = getInputDiagnostics()
    },
  })
  writeRef.current = write
  inputIoSnapshotRef.current = getInputDiagnostics()

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    parserRef.current = new RawInputProbeParser(nonceRef.current)
    term.open(container)
    term.focus()
    const timeout = window.setTimeout(
      () => publishFailure('Raw input probe timed out'),
      TIMEOUT_MS,
    )
    return () => {
      window.clearTimeout(timeout)
      void terminalSessionManager.close(TAB_ID)
      term.dispose()
    }
  }, [publishFailure, term])

  useEffect(() => {
    if (status !== 'connected' || sentCommandRef.current || finishedRef.current) {
      return
    }
    sentCommandRef.current = true
    writeRef.current(
      `${createRawInputProbeCommand(nonceRef.current, config.expectedHex)}\r`,
    )
  }, [config.expectedHex, publishFailure, status])

  useEffect(() => {
    if (status === 'error' && !finishedRef.current) {
      publishFailure('Raw input probe local PTY failed')
    }
  }, [publishFailure, status])

  return (
    <main
      ref={containerRef}
      className="h-dvh w-full overflow-hidden bg-black"
      onClick={() => term.focus()}
    />
  )
}
