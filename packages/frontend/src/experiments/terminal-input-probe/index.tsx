import { Terminal as TerminalComponent } from '@baicie/xterm'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ViewContainer, ViewContent, ViewHeader } from '@/components/view-container'
import { useTerminal } from '@/hooks/use-terminal'
import type { TerminalInputDiagnosticEvent } from '@/hooks/terminal-session-types'
import type { TerminalSessionIoSnapshot } from '@/features/terminal/services/terminal-session-io'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import {
  createTerminalInputProbeCommand,
  TerminalInputProbeParser,
} from './probe-protocol'
import {
  beginTerminalInputProbe,
  consumeTerminalInputProbeEvent,
  createTerminalInputProbeState,
} from './probe-state'
import { ProbeSidebar } from './components/probe-sidebar'
import { ProbeTerminalPanel } from './components/probe-terminal-panel'
import { ProbeAlerts } from './components/probe-alerts'
import { ProbeToolbar } from './components/probe-toolbar'
import type { InputEventLog } from './probe-types'
import '@baicie/xterm/css/xterm.css'

const PROBE_TAB_ID = 'terminal-input-probe-local'
const PROBE_WORKSPACE_ID = 'terminal-input-probe'
const MAX_EVENTS = 400

function toHex(data: string | Uint8Array): string {
  const bytes =
    typeof data === 'string' ? new TextEncoder().encode(data) : data
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export default function TerminalInputProbe() {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const parserRef = useRef<TerminalInputProbeParser | null>(null)
  const stateRef = useRef(createTerminalInputProbeState(30, 'asd'))
  const writeRef = useRef<(data: string) => void>(() => {})
  const getInputDiagnosticsRef = useRef<
    ReturnType<typeof useTerminal>['getInputDiagnostics']
  >(() => null)
  const eventIdRef = useRef(0)
  const nonceRef = useRef(`probe_${Date.now().toString(36)}`)
  const [term] = useState(
    () =>
      new TerminalComponent({
        cols: 96,
        rows: 24,
        cursorBlink: true,
        fontSize: 13,
        scrollback: 2_000,
        macOptionIsMeta: true,
        allowProposedApi: true,
      }),
  )
  const [rounds, setRounds] = useState('30')
  const [expectedText, setExpectedText] = useState('asd')
  const [probeState, setProbeState] = useState(stateRef.current)
  const [inputEvents, setInputEvents] = useState<InputEventLog[]>([])
  const [diagnostics, setDiagnostics] = useState<TerminalSessionIoSnapshot | null>(null)

  const appendInputEvent = useCallback((event: TerminalInputDiagnosticEvent) => {
    const next: InputEventLog = {
      id: ++eventIdRef.current,
      kind: event.kind,
      hex: toHex(event.data),
      bytes: event.bytes,
    }
    setInputEvents(current => [...current, next].slice(-MAX_EVENTS))
  }, [])

  const consumeOutput = useCallback((event: { data: string }) => {
    const parser = parserRef.current
    if (!parser) return
    for (const protocolEvent of parser.push(event.data)) {
      const next = consumeTerminalInputProbeEvent(
        stateRef.current,
        protocolEvent,
      )
      stateRef.current = next
      setProbeState(next)
      if (protocolEvent.kind === 'result' && next.phase === 'waiting-ready') {
        window.setTimeout(() => {
          if (stateRef.current.phase === 'waiting-ready') {
            writeRef.current(`${createTerminalInputProbeCommand(nonceRef.current)}\r`)
          }
        }, 0)
      }
    }
  }, [])

  const { status, error, write, getInputDiagnostics } = useTerminal(
    term,
    {
      tabId: PROBE_TAB_ID,
      workspaceId: PROBE_WORKSPACE_ID,
      tabType: 'local',
      onInput: appendInputEvent,
      onOutput: consumeOutput,
    },
  )
  writeRef.current = write
  getInputDiagnosticsRef.current = getInputDiagnostics

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    term.open(container)
    term.focus()
    return () => term.dispose()
  }, [term])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setDiagnostics(getInputDiagnosticsRef.current())
    }, 100)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    return () => {
      parserRef.current = null
      void terminalSessionManager.close(PROBE_TAB_ID)
    }
  }, [])

  const startProbe = () => {
    const next = beginTerminalInputProbe(
      createTerminalInputProbeState(
        Number.parseInt(rounds, 10),
        expectedText,
      ),
    )
    stateRef.current = next
    setProbeState(next)
    setInputEvents([])
    eventIdRef.current = 0
    parserRef.current = new TerminalInputProbeParser(nonceRef.current)
    term.focus()
    writeRef.current(`${createTerminalInputProbeCommand(nonceRef.current)}\r`)
  }

  const stopProbe = () => {
    writeRef.current('\x03')
    parserRef.current = null
    const next = { ...stateRef.current, phase: 'idle' as const }
    stateRef.current = next
    setProbeState(next)
  }

  const running =
    probeState.phase === 'waiting-ready' ||
    probeState.phase === 'awaiting-input'

  return (
    <ViewContainer>
      <ProbeToolbar
        status={status}
        phase={probeState.phase}
        running={running}
        onStart={startProbe}
        onStop={stopProbe}
      />

      <ViewContent className="p-4 md:p-6">
        <ViewHeader
          title={t('experiments.inputProbeTitle')}
          description={t('experiments.inputProbeDesc')}
        />
        <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <ProbeTerminalPanel
            containerRef={containerRef}
            probeState={probeState}
          />
          <ProbeSidebar
            rounds={rounds}
            expectedText={expectedText}
            onRoundsChange={setRounds}
            onExpectedTextChange={setExpectedText}
            running={running}
            probeState={probeState}
            diagnostics={diagnostics}
            inputEvents={inputEvents}
          />
        </div>

        <ProbeAlerts error={error} probeState={probeState} />
      </ViewContent>
    </ViewContainer>
  )
}
