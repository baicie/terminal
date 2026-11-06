import type { Terminal as TerminalComponent } from '@baicie/xterm'
import type { Host, Tab } from '@/types'
import type {
  TerminalInputDiagnosticEvent,
  TerminalOutputDiagnosticEvent,
  UseTerminalResult,
} from '@/hooks/terminal-session-types'
import { useSshHostKeyGate } from '@/features/terminal/hooks/use-ssh-host-key-gate'
import { useTerminal } from '@/hooks/use-terminal'
import type { TabType } from '@/features/terminal/types'

interface Options {
  termInstance: TerminalComponent | null
  tabId: string
  workspaceId: string
  tab: Tab | undefined
  host: Host | undefined
  jumpHost: Host | undefined
  outputWriter: Pick<TerminalComponent, 'write'> | undefined
  onOutput: (event: TerminalOutputDiagnosticEvent) => void
  onInput?: (event: TerminalInputDiagnosticEvent) => void
}

/**
 * A missing tab must not silently become a local shell.
 *
 * `TerminalContainer` renders its empty state before calling this hook in the
 * normal path, but during a workspace swap the tab object can disappear for one
 * render. Defaulting to `local` there used to launch a local PTY under a remote
 * tab id: the session stage said "created" while no SSH stage could ever
 * appear, which the stress classifier saw as a remote SSH failure (Issue #179).
 * "No tab" is now an idle surface; the hook starts only after the tab returns.
 */
const tabTypeOf = (tab: Tab | undefined): TabType | null => tab?.type ?? null

/**
 * Bind the pane to its live session. The host-key gate stays in front of the
 * connection so an unverified key is resolved before any session starts, and a
 * retry while gated re-runs the gate instead of reconnecting blindly.
 */
export function useTerminalSessionBinding(
  options: Options,
): UseTerminalResult & {
  reconnectAction: () => void
  hostKeyGate: ReturnType<typeof useSshHostKeyGate>
} {
  const tabType = tabTypeOf(options.tab)
  const hostKeyGate = useSshHostKeyGate({
    tabType: tabType ?? 'local',
    host: options.host,
    jumpHost: options.jumpHost,
  })
  const session = useTerminal(options.termInstance, {
    tabId: options.tabId,
    workspaceId: options.workspaceId,
    tabType: tabType ?? 'local',
    enabled: tabType !== null && hostKeyGate.enabled,
    expectedHostKey: hostKeyGate.expectedHostKey,
    expectedJumpHostKey: hostKeyGate.expectedJumpHostKey,
    connectionDeadlineAt: hostKeyGate.connectionDeadlineAt,
    host: options.host,
    jumpHost: options.jumpHost,
    serialSessionId: options.tab?.serialSessionId,
    outputWriter: options.outputWriter,
    onOutput: options.onOutput,
    onInput: options.onInput,
  })

  return {
    ...session,
    hostKeyGate,
    reconnectAction: hostKeyGate.enabled
      ? session.reconnect
      : hostKeyGate.retry,
  }
}
