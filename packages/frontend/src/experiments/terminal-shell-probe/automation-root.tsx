import { Terminal as TerminalComponent } from '@baicie/xterm'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { useTerminal } from '@/hooks/use-terminal'
import type { UseTerminalOptions } from '@/hooks/use-terminal'
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'
import {
  createNanoVerifyCommand,
  createResizeProbeCommand,
  createResizeVerdictCommand,
  createSetupCommand,
  createVimVerifyCommand,
  readySteps,
  stepSteps,
  verifyDelayMs,
  type ShellProbeDialect,
} from './dialect'
import {
  PTY_RESIZE_SEQUENCE,
  ShellProbeParser,
  type ShellProbeConfig,
  type ShellProbeInputEvent,
  type ShellProbeResult,
  publishShellProbeResult,
  expectedShellProbeTrace,
} from './protocol'
import '@baicie/xterm/css/xterm.css'

const TAB_ID = 'terminal-shell-probe'
const WORKSPACE_ID = 'terminal-shell-probe'
const TIMEOUT_MS = 30_000
/** Gap between a resize and the `stty size` probe that verifies it. */
const RESIZE_STEP_DELAY_MS = 300

/**
 * Builds the session request for the transport under test.
 *
 * A local PTY and a real sshd session differ in the three places that break
 * terminals in practice — PTY request, window-size propagation and signal
 * delivery — so the identical case scripts have to be able to run over both.
 * The host object is built here rather than seeded into SQLite: the probe is a
 * single-purpose automation surface and must not depend on stored state.
 */
function shellProbeSessionRequest(
  config: ShellProbeConfig,
): UseTerminalOptions {
  const ssh = config.ssh
  if (!ssh) {
    return { tabId: TAB_ID, workspaceId: WORKSPACE_ID, tabType: 'local' }
  }
  return {
    tabId: TAB_ID,
    workspaceId: WORKSPACE_ID,
    tabType: 'remote',
    expectedHostKey: ssh.expectedHostKey,
    cols: 100,
    rows: 32,
    host: {
      id: TAB_ID,
      name: 'Shell probe SSH',
      hostname: ssh.host,
      port: ssh.port,
      username: ssh.username,
      authType: ssh.authMode,
      ...(ssh.privateKey === null ? {} : { privateKey: ssh.privateKey }),
      ...(ssh.password === null ? {} : { password: ssh.password }),
      ...(ssh.certificate === null ? {} : { certificate: ssh.certificate }),
      isFavorite: false,
      portForwards: [],
      createdAt: 0,
      updatedAt: 0,
    },
  }
}

function toInputEvent(event: {
  kind: 'text' | 'raw'
  data: string | Uint8Array
  bytes: number
}): ShellProbeInputEvent {
  const bytes =
    typeof event.data === 'string'
      ? new TextEncoder().encode(event.data)
      : event.data
  return {
    kind: event.kind,
    bytes: event.bytes,
    dataHex: Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(
      '',
    ),
  }
}

export default function ShellProbeRoot({
  config,
}: {
  config: ShellProbeConfig
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const parserRef = useRef<ShellProbeParser | null>(null)
  const dialect: ShellProbeDialect = config.dialect
  const nonceRef = useRef(config.nonce)
  const inputEventsRef = useRef<ShellProbeInputEvent[]>([])
  const sentSetupRef = useRef(false)
  const finishedRef = useRef(false)
  const [startedAt] = useState(() => performance.now())
  const [term] = useState(
    () =>
      new TerminalComponent({
        cols: 100,
        rows: 32,
        cursorBlink: false,
        allowProposedApi: true,
      }),
  )

  const publish = useCallback(
    (ok: boolean, error: string | null) => {
      if (finishedRef.current) return
      finishedRef.current = true
      const result: ShellProbeResult = {
        caseName: config.caseName,
        durationMs: Math.max(1, Math.ceil(performance.now() - startedAt)),
        error,
        inputEvents: inputEventsRef.current,
        ok,
        trace: expectedShellProbeTrace(config.caseName),
      }
      void publishShellProbeResult(result).catch(reportError => {
        console.error('Failed to publish shell probe result:', reportError)
      })
    },
    [config.caseName, startedAt],
  )

  const sendUserInput = useCallback(
    (data: string) => {
      // Deliberately use xterm's user-input path: onData -> session FIFO -> PTY.
      term.input(data, true)
    },
    [term],
  )

  const runResizeSequence = useCallback(() => {
    // Each step resizes the terminal, then asks the PTY what size it actually
    // ended up with. The observation is compared here rather than in the shell
    // so a mismatch is reported against the size that was requested, which is
    // what a user would notice. The final probe also prints the verdict.
    PTY_RESIZE_SEQUENCE.forEach((size, index) => {
      window.setTimeout(
        () => {
          term.resize(size.cols, size.rows)
          const isLast = index === PTY_RESIZE_SEQUENCE.length - 1
          sendUserInput(
            `${
              isLast
                ? createResizeVerdictCommand(dialect, nonceRef.current, size)
                : createResizeProbeCommand(dialect, nonceRef.current)
            }\r`,
          )
        },
        RESIZE_STEP_DELAY_MS * (index + 1),
      )
    })
  }, [dialect, sendUserInput, term])

  const triggerReady = useCallback(() => {
    if (config.caseName === 'pty-resize') {
      runResizeSequence()
      return
    }
    if (config.caseName === 'vim-edit' || config.caseName === 'nano-edit') {
      // The editor owns the TTY while it runs, so the shell cannot print the
      // step marker before the editor exits. Driving the whole edit sequence
      // from `ready` keeps the shell from deadlocking: waiting for `step`
      // before sending any keys would mean the editor never receives them and
      // the probe can only time out.
      for (const step of readySteps(
        dialect,
        config.caseName,
        nonceRef.current,
      )) {
        window.setTimeout(() => sendUserInput(step.data), step.delayMs)
      }
      window.setTimeout(
        () =>
          sendUserInput(
            `${
              config.caseName === 'vim-edit'
                ? createVimVerifyCommand(dialect, nonceRef.current)
                : createNanoVerifyCommand(dialect, nonceRef.current)
            }\r`,
          ),
        verifyDelayMs(config.caseName),
      )
      return
    }
    for (const step of readySteps(dialect, config.caseName, nonceRef.current)) {
      if (!step.data) continue
      window.setTimeout(() => sendUserInput(step.data), step.delayMs)
    }
  }, [config.caseName, dialect, runResizeSequence, sendUserInput])

  const triggerStep = useCallback(() => {
    for (const step of stepSteps(dialect, config.caseName, nonceRef.current)) {
      window.setTimeout(() => sendUserInput(step.data), step.delayMs)
    }
  }, [config.caseName, dialect, sendUserInput])

  const { status } = useTerminal(term, {
    ...shellProbeSessionRequest(config),
    onOutput: event => {
      const parser = parserRef.current
      if (!parser || finishedRef.current) return
      try {
        for (const protocolEvent of parser.push(event.data)) {
          if (protocolEvent.kind === 'ready') triggerReady()
          else if (protocolEvent.kind === 'step') triggerStep()
          else if (protocolEvent.kind === 'pass') publish(true, null)
          else publish(false, 'shell-side probe reported failure')
        }
      } catch (error) {
        publish(false, error instanceof Error ? error.message : String(error))
      }
    },
    onInput: event => {
      inputEventsRef.current.push(toInputEvent(event))
    },
  })

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    parserRef.current = new ShellProbeParser(nonceRef.current, config.caseName)
    term.open(container)
    term.focus()
    const timeout = window.setTimeout(
      () => {
        publish(false, 'terminal shell probe timed out')
      },
      Math.max(TIMEOUT_MS, config.timeoutMs),
    )
    return () => {
      window.clearTimeout(timeout)
      void terminalSessionManager.close(TAB_ID)
      term.dispose()
    }
  }, [config.caseName, config.timeoutMs, publish, term])

  useEffect(() => {
    if (status !== 'connected' || sentSetupRef.current || finishedRef.current)
      return
    sentSetupRef.current = true
    sendUserInput(
      `${createSetupCommand(dialect, nonceRef.current, config.caseName)}\r`,
    )
  }, [config.caseName, dialect, sendUserInput, status])

  useEffect(() => {
    if (status === 'error' && !finishedRef.current) {
      publish(false, config.ssh ? 'SSH session failed' : 'local PTY failed')
    }
  }, [config.ssh, publish, status])

  return (
    <main
      ref={containerRef}
      className="h-dvh w-full overflow-hidden bg-black"
      onClick={() => term.focus()}
    />
  )
}
