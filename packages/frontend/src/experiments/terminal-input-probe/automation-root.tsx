import { Terminal as TerminalComponent } from '@baicie/xterm'
import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTerminal } from '@/hooks/use-terminal'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import {
  createTerminalInputProbeCommand,
  encodeTerminalInputProbeText,
  TerminalInputProbeParser,
} from './probe-protocol'
import {
  beginTerminalInputProbe,
  consumeTerminalInputProbeEvent,
  createTerminalInputProbeState,
} from './probe-state'
import {
  focusInputProbeWindow,
  publishInputProbeDiag,
  publishInputProbeReady,
  publishInputProbeResult,
  type InputProbeAutomationConfig,
  type InputProbeAutomationResult,
} from './probe-automation'
import '@baicie/xterm/css/xterm.css'

const TAB_ID = 'terminal-input-probe-automation'
const WORKSPACE_ID = 'terminal-input-probe-automation'
const AUTOMATION_TIMEOUT_MS = 180_000

function failureResult(
  config: InputProbeAutomationConfig,
  startedAt: number,
  expectedHex: string,
  results: InputProbeAutomationResult['results'],
  error: string,
): InputProbeAutomationResult {
  return {
    ok: false,
    rounds: config.rounds,
    expectedText: config.expectedText,
    expectedHex,
    durationMs: Math.max(1, Math.ceil(performance.now() - startedAt)),
    results,
    error,
  }
}

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
      console.error('Failed to publish terminal input probe result:', publishError)
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
    onOutput: event => {
      const parser = parserRef.current
      if (!parser || finishedRef.current) return
      try {
        for (const protocolEvent of parser.push(event.data)) {
          const next = consumeTerminalInputProbeEvent(
            stateRef.current,
            protocolEvent,
          )
          stateRef.current = next
          if (next.phase === 'awaiting-input') {
            void publishInputProbeReady(next.currentRound).catch(() => {
              publishFailure('Failed to publish the terminal input probe checkpoint')
            })
          }
          if (next.phase === 'waiting-ready') {
            window.setTimeout(() => {
              if (stateRef.current.phase === 'waiting-ready') {
                writeRef.current(
                  `${createTerminalInputProbeCommand(nonceRef.current)}\r`,
                )
              }
            }, 0)
          }
          if (next.phase === 'complete' && !finishedRef.current) {
            finishedRef.current = true
            const state = stateRef.current
            const failedRounds = state.results
              .filter(result => !result.ok)
              .map(result => result.round)
            const ok = failedRounds.length === 0
            void publishInputProbeResult({
              ok,
              rounds: config.rounds,
              expectedText: config.expectedText,
              expectedHex: state.expectedHex,
              durationMs: Math.max(1, Math.ceil(performance.now() - startedAt)),
              results: state.results,
              error: ok
                ? null
                : `round(s) ${failedRounds.join(',')} received mismatched bytes`,
            }).catch(publishError => {
              console.error('Failed to publish terminal input probe result')
              void publishInputProbeDiag(
                `result-publish-failed: ${String(publishError)}`,
              ).catch(() => {})
            })
          }
          if (next.phase === 'error') {
            publishFailure(next.error ?? 'Terminal input probe protocol error')
          }
        }
      } catch (error) {
        publishFailure(error instanceof Error ? error.message : String(error))
      }
    },
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
    const timeout = window.setTimeout(() => {
      publishFailure('Terminal input probe automation timed out')
    }, AUTOMATION_TIMEOUT_MS)
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
      writeRef.current(
        `${createTerminalInputProbeCommand(nonceRef.current)}\r`,
      )
    }, 0)
  }, [status])

  useEffect(() => {
    if (status === 'error' && !finishedRef.current) {
      publishFailure('Terminal input probe local PTY failed')
    }
  }, [publishFailure, status])

  // Diagnostics: observe keydown delivery and focus transitions.
  useEffect(() => {
    const diag = (message: string) => {
      void publishInputProbeDiag(message).catch(() => {})
    }
    const onKeyDown = (event: KeyboardEvent) => {
      diag(`keydown key=${event.key} code=${event.code}`)
    }
    const onFocus = () => {
      diag('window-focus')
      // The window can become key long after mount; WebKit does not always
      // route keystrokes to the xterm textarea that was focused earlier.
      term.focus()
    }
    const onBlur = () => diag('window-blur')
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('focus', onFocus)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('blur', onBlur)
    }
  }, [term])

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

  return <main className="h-dvh w-full overflow-hidden bg-black" ref={containerRef} />
}

const AUTOMATION_STARTED_AT = performance.now()

class InputProbeErrorBoundary extends Component<
  { children: ReactNode; config: InputProbeAutomationConfig },
  { error: string | null }
> {
  state = { error: null as string | null }

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }

  componentDidCatch(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    const config = this.props.config
    void publishInputProbeResult({
      ok: false,
      rounds: config.rounds,
      expectedText: config.expectedText,
      expectedHex: encodeTerminalInputProbeText(config.expectedText),
      durationMs: Math.max(1, Math.ceil(performance.now() - AUTOMATION_STARTED_AT)),
      results: [],
      error: `input probe crash: ${message}`,
    }).catch(() => {})
  }

  render() {
    if (this.state.error) return null
    return this.props.children
  }
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
