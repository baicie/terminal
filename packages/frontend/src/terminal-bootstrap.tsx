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
  bootstrapNow,
  loadBootstrapConfig,
  loadOptionalBootstrapConfigs,
} from './terminal-bootstrap-deadline'

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
  const config = await loadBootstrapConfig(
    dependencies.loadConfig,
    configDeadlineAt,
    signal,
  )
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
    return 'smoke'
  }

  const configs = await loadOptionalBootstrapConfigs(
    {
      remotePrompt: dependencies.loadRemotePromptProbeConfig,
      inputProbe: dependencies.loadProbeConfig,
      rawProbe: dependencies.loadRawProbeConfig,
      shellProbe: dependencies.loadShellProbeConfig,
    },
    configDeadlineAt,
    signal,
  )
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
      startupTerminalFallbackAt: startupDeadlineAt,
    }),
  )
  return 'app'
}
