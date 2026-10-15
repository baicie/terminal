import { createElement, type ComponentType } from 'react'
import { renderStartupFailure } from './terminal-bootstrap-failure-ui'
import type { RenderRoot } from './terminal-bootstrap-types'
import { reportTerminalSmokeBootstrapFailure } from './terminal-bootstrap-failure'
import {
  loadInputProbeAutomationConfig,
  type InputProbeAutomationConfig,
} from './experiments/terminal-input-probe/probe-automation'
import {
  loadRawInputProbeConfig,
  type RawInputProbeConfig,
} from './experiments/terminal-raw-input-probe/protocol'
import {
  loadShellProbeConfig,
  type ShellProbeConfig,
} from './experiments/terminal-shell-probe/protocol'
import {
  emitTerminalSmokeStaleOutput,
  loadTerminalSmokeConfig,
  reportTerminalSmokeConnected,
  reportTerminalSmokeReconnect,
  reportTerminalSmokeHostWake,
  submitTerminalSmokeResult,
  type TerminalSmokeConfig,
  type TerminalSmokeResult,
} from './features/terminal/smoke/terminal-smoke-contract'
import {
  configureRemotePromptProbe,
  loadRemotePromptProbeConfig,
  type RemotePromptProbeConfig,
} from './features/terminal/services/remote-prompt-probe'

export { reportTerminalSmokeBootstrapFailure } from './terminal-bootstrap-failure'

type BootstrapMode = 'app' | 'smoke' | 'probe' | 'raw-probe' | 'shell-probe'

type SubmitTerminalSmokeResult = (result: TerminalSmokeResult) => Promise<void>

interface BootstrapDependencies {
  loadConfig: () => Promise<TerminalSmokeConfig | null>
  loadProbeConfig: () => Promise<InputProbeAutomationConfig | null>
  loadRawProbeConfig?: () => Promise<RawInputProbeConfig | null>
  loadShellProbeConfig?: () => Promise<ShellProbeConfig | null>
  loadRemotePromptProbeConfig?: () => Promise<RemotePromptProbeConfig | null>
  loadApp: () => Promise<ComponentType>
  loadSmokeRoot: () => Promise<
    ComponentType<{
      config: TerminalSmokeConfig
      emitStaleOutput: typeof emitTerminalSmokeStaleOutput
      reportConnected: () => Promise<number>
      reportReconnect: () => Promise<void>
      reportHostWake: () => Promise<void>
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

type BootstrapFailureReporter = (error: unknown) => Promise<void>

const defaultDependencies: BootstrapDependencies = {
  loadConfig: loadTerminalSmokeConfig,
  loadProbeConfig: loadInputProbeAutomationConfig,
  loadApp: async () => (await import('./App.tsx')).default,
  loadSmokeRoot: async () => {
    if (import.meta.env.VITE_TERMINAL_SMOKE_BUILD !== '1') {
      throw new Error('Terminal smoke UI is not included in this build')
    }
    return (await import('./features/terminal/smoke/terminal-smoke-root'))
      .default
  },
  loadProbeRoot: async () => {
    if (import.meta.env.VITE_TERMINAL_SMOKE_BUILD !== '1') {
      throw new Error('Terminal input probe UI is not included in this build')
    }
    return (await import('./experiments/terminal-input-probe/automation-root'))
      .default
  },
  loadRawProbeConfig: loadRawInputProbeConfig,
  loadRemotePromptProbeConfig,
  loadRawProbeRoot: async () => {
    if (import.meta.env.VITE_TERMINAL_SMOKE_BUILD !== '1') {
      throw new Error('Raw input probe UI is not included in this build')
    }
    return (await import('./experiments/terminal-raw-input-probe/automation-root'))
      .default
  },
  loadShellProbeConfig,
  loadShellProbeRoot: async () => {
    if (import.meta.env.VITE_TERMINAL_SMOKE_BUILD !== '1') {
      throw new Error('Terminal shell probe UI is not included in this build')
    }
    return (await import('./experiments/terminal-shell-probe/automation-root'))
      .default
  },
}

export async function bootstrapTerminalApp(
  root: RenderRoot,
  dependencies: BootstrapDependencies = defaultDependencies,
): Promise<BootstrapMode> {
  const config = await dependencies.loadConfig()
  if (config !== null) {
    const SmokeRoot = await dependencies.loadSmokeRoot()
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

  configureRemotePromptProbe(
    (await dependencies.loadRemotePromptProbeConfig?.()) ?? null,
  )

  const probeConfig = await dependencies.loadProbeConfig()
  if (probeConfig !== null) {
    const ProbeRoot = await dependencies.loadProbeRoot()
    root.render(createElement(ProbeRoot, { config: probeConfig }))
    return 'probe'
  }

  const rawProbeConfig = await dependencies.loadRawProbeConfig?.()
  if (rawProbeConfig !== null && rawProbeConfig !== undefined) {
    const RawProbeRoot = await dependencies.loadRawProbeRoot?.()
    if (!RawProbeRoot) throw new Error('Raw input probe UI loader is unavailable')
    root.render(createElement(RawProbeRoot, { config: rawProbeConfig }))
    return 'raw-probe'
  }

  const shellProbeConfig = await dependencies.loadShellProbeConfig?.()
  if (shellProbeConfig !== null && shellProbeConfig !== undefined) {
    const ShellProbeRoot = await dependencies.loadShellProbeRoot?.()
    if (!ShellProbeRoot) throw new Error('Terminal shell probe UI loader is unavailable')
    root.render(createElement(ShellProbeRoot, { config: shellProbeConfig }))
    return 'shell-probe'
  }

  const App = await dependencies.loadApp()
  root.render(createElement(App))
  return 'app'
}

export function startTerminalApp(
  root: RenderRoot,
  dependencies: BootstrapDependencies = defaultDependencies,
  reportFailure: BootstrapFailureReporter = reportTerminalSmokeBootstrapFailure,
): void {
  let starting = false
  let disposed = false

  const start = async (): Promise<void> => {
    if (starting || disposed) return
    starting = true
    try {
      await bootstrapTerminalApp(root, dependencies)
    } catch (error) {
      console.error('Failed to bootstrap terminal application:', error)
      renderStartupFailure(root, error, () => void start(), () => disposed)
      void reportFailure(error).catch(reportError => {
        console.error(
          'Failed to report terminal smoke bootstrap error:',
          reportError,
        )
      })
    } finally {
      starting = false
    }
  }

  void start()
}
