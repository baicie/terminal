import type { Terminal as TerminalComponent } from '@baicie/xterm'
import type { Host, Tab } from '@/types'
import type {
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
}

const tabTypeOf = (tab: Tab | undefined): TabType => tab?.type ?? 'local'

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
  const hostKeyGate = useSshHostKeyGate({
    tabType: tabTypeOf(options.tab),
    host: options.host,
    jumpHost: options.jumpHost,
  })
  const session = useTerminal(options.termInstance, {
    tabId: options.tabId,
    workspaceId: options.workspaceId,
    tabType: tabTypeOf(options.tab),
    enabled: hostKeyGate.enabled,
    expectedHostKey: hostKeyGate.expectedHostKey,
    expectedJumpHostKey: hostKeyGate.expectedJumpHostKey,
    host: options.host,
    jumpHost: options.jumpHost,
    serialSessionId: options.tab?.serialSessionId,
    outputWriter: options.outputWriter,
    onOutput: options.onOutput,
  })

  return {
    ...session,
    hostKeyGate,
    reconnectAction: hostKeyGate.enabled
      ? session.reconnect
      : hostKeyGate.retry,
  }
}
