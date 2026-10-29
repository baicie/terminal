import type { BootstrapDependencies } from './terminal-bootstrap'
import { loadInputProbeAutomationConfig } from './experiments/terminal-input-probe/probe-automation'
import { loadRawInputProbeConfig } from './experiments/terminal-raw-input-probe/protocol'
import { loadShellProbeConfig } from './experiments/terminal-shell-probe/protocol'
import { loadTerminalSmokeConfig } from './features/terminal/smoke/terminal-smoke-contract'
import { loadRemotePromptProbeConfig } from './features/terminal/services/remote-prompt-probe'

export const defaultBootstrapDependencies: BootstrapDependencies = {
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
    return (
      await import('./experiments/terminal-raw-input-probe/automation-root')
    ).default
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
