import { Terminal as TerminalComponent } from '@baicie/xterm'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useTerminal } from '@/hooks/use-terminal'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import {
  createTerminalInputProbeCommand,
  TerminalInputProbeParser,
} from './probe-protocol'
import {
  beginTerminalInputProbe,
  createTerminalInputProbeState,
} from './probe-state'
import {
  focusInputProbeWindow,
  publishInputProbeResult,
  type InputProbeAutomationConfig,
} from './probe-automation'
import { InputProbeErrorBoundary } from './probe-error-boundary'
import { consumeProbeOutput } from './probe-output'
import { failureResult } from './probe-result'
import {
  inputProbeDiagnostic,
  useInputProbeDiagnostics,
} from './use-input-probe-diagnostics'
import '@baicie/xterm/css/xterm.css'

const TAB_ID = 'terminal-input-probe-automation'
const WORKSPACE_ID = 'terminal-input-probe-automation'
const AUTOMATION_TIMEOUT_MS = 180_000

function TerminalInputProbeAutomationInner({
  config,
}: {
  config: InputProbeAutomationConfig
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const stateRef = useRef(
    createTerminalInputProbeState(config.rounds, config.expectedText),
  )
  const parserRef = useRef<TerminalInputProbeParser | null>(null)
  const [startedAt] = useState(() => performance.now())
  const finishedRef = useRef(false)
  const firstCommandSentRef = useRef(false)
  const writeRef = useRef<(data: string) => void>(() => {})
  const nonceRef = useRef(`probe_auto_${Date.now().toString(36)}`)
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

  const publishFailure = useCallback(
    (error: string) => {
      if (finishedRef.current) return
      finishedRef.current = true
      const state = stateRef.current
      void publishInputProbeResult(
        failureResult(
          config,
          startedAt,
          state.expectedHex,
          state.results,
          error,
        ),
      ).catch(publishError => {
        console.error(
          'Failed to publish terminal input probe result:',
          publishError,
        )
      })
    },
    [config, startedAt],
  )

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      publishFailure(`uncaught webview error: ${event.message}`)
    }
    const onRejection = (event: PromiseRejectionEvent) => {
      publishFailure(`unhandled rejection: ${String(event.reason)}`)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [publishFailure])

  const { status, write } = useTerminal(term, {
    tabId: TAB_ID,
    workspaceId: WORKSPACE_ID,
    tabType: 'local',
    onOutput: event =>
      consumeProbeOutput(event.data, {
        parserRef,
        finishedRef,
        stateRef,
        writeRef,
        nonceRef,
        config,
        startedAt,
        publishFailure,
      }),
    onInput: inputProbeDiagnostic,
  })
  writeRef.current = write

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    parserRef.current = new TerminalInputProbeParser(nonceRef.current)
    stateRef.current = beginTerminalInputProbe(
      createTerminalInputProbeState(config.rounds, config.expectedText),
    )
    term.open(container)
    term.focus()
    // The Node driver gives each manual round up to two minutes. Keep the
    // webview alive for the same bounded per-round budget plus startup slack.
    const timeout = window.setTimeout(() => {
      publishFailure('Terminal input probe automation timed out')
    }, Math.max(AUTOMATION_TIMEOUT_MS, config.rounds * 120_000 + 30_000))
    return () => {
      window.clearTimeout(timeout)
      void terminalSessionManager.close(TAB_ID)
      term.dispose()
    }
  }, [config.expectedText, config.rounds, publishFailure, term])

  useEffect(() => {
    if (
      firstCommandSentRef.current ||
      finishedRef.current ||
      status === 'idle'
    ) {
      return
    }
    firstCommandSentRef.current = true
    window.setTimeout(() => {
      writeRef.current(`${createTerminalInputProbeCommand(nonceRef.current)}\r`)
    }, 0)
  }, [status])

  useEffect(() => {
    if (status === 'error' && !finishedRef.current) {
      publishFailure('Terminal input probe local PTY failed')
    }
  }, [publishFailure, status])

  useInputProbeDiagnostics(term)

  // Keep the probe window key while rounds await injected keystrokes,
  // but never re-assert focus while it already has focus: re-activating
  // mid-injection can interrupt the key event stream.
  useEffect(() => {
    const focusOnce = () => {
      if (finishedRef.current || document.hasFocus()) return
      void focusInputProbeWindow().catch(() => {
        // The probe still works when focus cannot be forced mid-round.
      })
    }
    focusOnce()
    const timer = window.setInterval(focusOnce, 500)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <main
      className="h-dvh w-full overflow-hidden bg-black"
      ref={containerRef}
      onClick={() => term.focus()}
    />
  )
}

export default function TerminalInputProbeAutomation(props: {
  config: InputProbeAutomationConfig
}) {
  return (
    <InputProbeErrorBoundary config={props.config}>
      <TerminalInputProbeAutomationInner config={props.config} />
    </InputProbeErrorBoundary>
  )
}
