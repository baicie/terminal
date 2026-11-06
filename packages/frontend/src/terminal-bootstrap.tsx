import { createElement, type ComponentType } from 'react'
import type { RenderRoot } from './terminal-bootstrap-types'
import { type InputProbeAutomationConfig } from './experiments/terminal-input-probe/probe-automation'
import { type RawInputProbeConfig } from './experiments/terminal-raw-input-probe/protocol'
import { type ShellProbeConfig } from './experiments/terminal-shell-probe/protocol'
import {
  emitTerminalSmokeStaleOutput,
  reportTerminalSmokeConnected,
  reportTerminalSmokeReconnect,
  reportTerminalSmokeHostWake,
  submitTerminalSmokeResult,
  type TerminalSmokeConfig,
  type TerminalSmokeHostWakeReporter,
  type TerminalSmokeResult,
} from './features/terminal/smoke/terminal-smoke-contract'
import {
  configureRemotePromptProbe,
  type RemotePromptProbeConfig,
} from './features/terminal/services/remote-prompt-probe'
import { defaultBootstrapDependencies } from './terminal-bootstrap-default-dependencies'
import {
  BOOTSTRAP_CONFIG_DEADLINE_MS,
  BOOTSTRAP_APP_DEADLINE_MS,
  BOOTSTRAP_TERMINAL_FALLBACK_MS,
  bootstrapNow,
  loadBootstrapConfig,
} from './terminal-bootstrap-deadline'
import { loadBootstrapGates } from './terminal-bootstrap-gate-loader'

export { reportTerminalSmokeBootstrapFailure } from './terminal-bootstrap-failure'
export { BOOTSTRAP_CONFIG_DEADLINE_MS } from './terminal-bootstrap-deadline'
export { BOOTSTRAP_APP_DEADLINE_MS } from './terminal-bootstrap-deadline'

type BootstrapMode = 'app' | 'smoke' | 'probe' | 'raw-probe' | 'shell-probe'

type SubmitTerminalSmokeResult = (result: TerminalSmokeResult) => Promise<void>

export interface BootstrapDependencies {
  loadConfig: () => Promise<TerminalSmokeConfig | null>
  loadProbeConfig: () => Promise<InputProbeAutomationConfig | null>
  loadRawProbeConfig?: () => Promise<RawInputProbeConfig | null>
  loadShellProbeConfig?: () => Promise<ShellProbeConfig | null>
  loadRemotePromptProbeConfig?: () => Promise<RemotePromptProbeConfig | null>
  loadApp: () => Promise<ComponentType<{ startupTerminalFallbackAt?: number }>>
  /** Override the normal App chunk deadline in bootstrap tests. */
  appLoadTimeoutMs?: number
  /** Override probe/smoke root deadlines in bootstrap tests. */
  rootLoadTimeoutMs?: number
  loadSmokeRoot: () => Promise<
    ComponentType<{
      config: TerminalSmokeConfig
      emitStaleOutput: typeof emitTerminalSmokeStaleOutput
      reportConnected: () => Promise<number>
      reportReconnect: () => Promise<void>
      reportHostWake: TerminalSmokeHostWakeReporter
      submitResult: SubmitTerminalSmokeResult
    }>
  >
  loadProbeRoot: () => Promise<
    ComponentType<{ config: InputProbeAutomationConfig }>
  >
  loadRawProbeRoot?: () => Promise<
    ComponentType<{ config: RawInputProbeConfig }>
  >
  loadShellProbeRoot?: () => Promise<
    ComponentType<{ config: ShellProbeConfig }>
  >
}

async function loadBootstrapRoot<T>(
  loader: (() => Promise<T>) | undefined,
  label: string,
  deadlineAt: number,
  signal?: AbortSignal,
): Promise<T> {
  if (!loader) throw new Error(`${label} loader is unavailable`)
  const root = await loadBootstrapConfig(loader, deadlineAt, signal)
  if (root === null) {
    throw new Error(`${label} did not load before its bootstrap deadline`)
  }
  return root
}

export async function bootstrapTerminalApp(
  root: RenderRoot,
  dependencies: BootstrapDependencies = defaultBootstrapDependencies,
  signal?: AbortSignal,
  startupDeadlineAt = bootstrapNow() + BOOTSTRAP_APP_DEADLINE_MS,
): Promise<BootstrapMode> {
  const attemptStartedAt = startupDeadlineAt - BOOTSTRAP_APP_DEADLINE_MS
  const configDeadlineAt = Math.min(
    startupDeadlineAt,
    attemptStartedAt + BOOTSTRAP_CONFIG_DEADLINE_MS,
  )
  const rootDeadlineAt = Math.min(
    startupDeadlineAt,
    attemptStartedAt +
      (dependencies.rootLoadTimeoutMs ?? BOOTSTRAP_APP_DEADLINE_MS),
  )
  const gates = await loadBootstrapGates(
    {
      smoke: dependencies.loadConfig,
      remotePrompt: dependencies.loadRemotePromptProbeConfig,
      inputProbe: dependencies.loadProbeConfig,
      rawProbe: dependencies.loadRawProbeConfig,
      shellProbe: dependencies.loadShellProbeConfig,
    },
    configDeadlineAt,
    signal,
  )
  const reportMode = gates.reportMode
  const config = gates.smoke
  if (config !== null) {
    const SmokeRoot = await loadBootstrapRoot(
      dependencies.loadSmokeRoot,
      'terminal smoke UI module',
      rootDeadlineAt,
      signal,
    )
    root.render(
      createElement(SmokeRoot, {
        config,
        emitStaleOutput: emitTerminalSmokeStaleOutput,
        reportConnected: reportTerminalSmokeConnected,
        reportReconnect: reportTerminalSmokeReconnect,
        reportHostWake: reportTerminalSmokeHostWake,
        submitResult: submitTerminalSmokeResult,
      }),
    )
    reportMode('smoke')
    return 'smoke'
  }

  const configs = gates.optional
  configureRemotePromptProbe(configs.remotePrompt)

  const probeConfig = configs.inputProbe
  if (probeConfig !== null) {
    const ProbeRoot = await loadBootstrapRoot(
      dependencies.loadProbeRoot,
      'terminal input probe UI module',
      rootDeadlineAt,
      signal,
    )
    root.render(createElement(ProbeRoot, { config: probeConfig }))
    reportMode('probe')
    return 'probe'
  }

  const rawProbeConfig = configs.rawProbe
  if (rawProbeConfig !== null && rawProbeConfig !== undefined) {
    const RawProbeRoot = await loadBootstrapRoot(
      dependencies.loadRawProbeRoot,
      'raw input probe UI module',
      rootDeadlineAt,
      signal,
    )
    root.render(createElement(RawProbeRoot, { config: rawProbeConfig }))
    reportMode('raw-probe')
    return 'raw-probe'
  }

  const shellProbeConfig = configs.shellProbe
  if (shellProbeConfig !== null && shellProbeConfig !== undefined) {
    const ShellProbeRoot = await loadBootstrapRoot(
      dependencies.loadShellProbeRoot,
      'terminal shell probe UI module',
      rootDeadlineAt,
      signal,
    )
    root.render(createElement(ShellProbeRoot, { config: shellProbeConfig }))
    reportMode('shell-probe')
    return 'shell-probe'
  }

  const appLoadTimeoutMs =
    dependencies.appLoadTimeoutMs ?? BOOTSTRAP_APP_DEADLINE_MS
  const appDeadlineAt = Math.min(
    startupDeadlineAt,
    attemptStartedAt + appLoadTimeoutMs,
  )
  const App = await loadBootstrapRoot(
    dependencies.loadApp,
    'normal application module',
    appDeadlineAt,
    signal,
  )
  root.render(
    createElement(App, {
      // The app-chunk deadline (8 s) is not the terminal fallback deadline.
      // Passing it here delayed the local fallback to ~8 s and left only ~2 s
      // of the 10 s probe budget (Issue #184).
      startupTerminalFallbackAt:
        attemptStartedAt + BOOTSTRAP_TERMINAL_FALLBACK_MS,
    }),
  )
  reportMode('app')
  return 'app'
}
