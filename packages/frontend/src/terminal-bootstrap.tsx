import { createElement, type ComponentType, type ReactNode } from 'react'
import {
  loadInputProbeAutomationConfig,
  type InputProbeAutomationConfig,
} from './experiments/terminal-input-probe/probe-automation'
import {
  emitTerminalSmokeStaleOutput,
  loadTerminalSmokeConfig,
  reportTerminalSmokeConnected,
  reportTerminalSmokeReconnect,
  submitTerminalSmokeResult,
  type TerminalSmokeConfig,
  type TerminalSmokeResult,
} from './features/terminal/smoke/terminal-smoke-contract'

type BootstrapMode = 'app' | 'smoke' | 'probe'

interface RenderRoot {
  render(children: ReactNode): void
}

type SubmitTerminalSmokeResult = (result: TerminalSmokeResult) => Promise<void>

interface BootstrapDependencies {
  loadConfig: () => Promise<TerminalSmokeConfig | null>
  loadProbeConfig: () => Promise<InputProbeAutomationConfig | null>
  loadApp: () => Promise<ComponentType>
  loadSmokeRoot: () => Promise<
    ComponentType<{
      config: TerminalSmokeConfig
      emitStaleOutput: typeof emitTerminalSmokeStaleOutput
      reportConnected: () => Promise<number>
      reportReconnect: () => Promise<void>
      submitResult: SubmitTerminalSmokeResult
    }>
  >
  loadProbeRoot: () => Promise<ComponentType<{ config: InputProbeAutomationConfig }>>
}

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
    return (
      await import('./experiments/terminal-input-probe/automation-root')
    ).default
  },
}

export async function reportTerminalSmokeBootstrapFailure(
  error: unknown,
  submit: (
    result: TerminalSmokeResult,
  ) => Promise<void> = submitTerminalSmokeResult,
): Promise<void> {
  await submit({
    ok: false,
    stage: 'mounting',
    error: error instanceof Error ? error.message : String(error),
    loadBytes: 0,
    roundsCompleted: 0,
    uniqueSessionCount: 0,
    resourcesRecovered: false,
    durationMs: 1,
    terminalCols: 80,
    terminalRows: 24,
    loadEndVisible: false,
    afterLoadVisible: false,
    resizedSizeVisible: false,
    reconnectObserved: false,
    staleOutputRejected: false,
    firstConnectionMs: 0,
  })
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
        submitResult: submitTerminalSmokeResult,
      }),
    )
    return 'smoke'
  }

  const probeConfig = await dependencies.loadProbeConfig()
  if (probeConfig !== null) {
    const ProbeRoot = await dependencies.loadProbeRoot()
    root.render(createElement(ProbeRoot, { config: probeConfig }))
    return 'probe'
  }

  const App = await dependencies.loadApp()
  root.render(createElement(App))
  return 'app'
}
