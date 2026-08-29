import type { ComponentType } from 'react'
import { expect, it, vi } from 'vitest'
import {
  bootstrapTerminalApp,
  reportTerminalSmokeBootstrapFailure,
} from './terminal-bootstrap'
import type { TerminalSmokeConfig } from './features/terminal/smoke/terminal-smoke-contract'
import { terminalSmokeTestConfig } from './features/terminal/smoke/terminal-smoke-test-fixtures'

const config = terminalSmokeTestConfig

const probeDependencies = () => ({
  loadProbeConfig: vi.fn().mockResolvedValue(null),
  loadProbeRoot: vi.fn(),
})

it('loads only the smoke root when Rust enables terminal smoke mode', async () => {
  const render = vi.fn()
  const loadApp = vi.fn()
  const SmokeRoot: ComponentType<{ config: TerminalSmokeConfig }> = () => null

  const mode = await bootstrapTerminalApp(
    { render },
    {
      loadConfig: vi.fn().mockResolvedValue(config),
      loadSmokeRoot: vi.fn().mockResolvedValue(SmokeRoot),
      loadApp,
      ...probeDependencies(),
    },
  )

  expect(mode).toBe('smoke')
  expect(loadApp).not.toHaveBeenCalled()
  expect(render.mock.calls[0][0].type).toBe(SmokeRoot)
  expect(render.mock.calls[0][0].props.submitResult).toEqual(
    expect.any(Function),
  )
  expect(render.mock.calls[0][0].props.reportConnected).toEqual(
    expect.any(Function),
  )
  expect(render.mock.calls[0][0].props.emitStaleOutput).toEqual(
    expect.any(Function),
  )
})

it('loads only the input probe root when Rust enables probe mode', async () => {
  const render = vi.fn()
  const loadApp = vi.fn()
  const ProbeRoot: ComponentType<{ config: unknown }> = () => null
  const probeConfig = {
    readyPath: '/tmp/ready.json',
    resultPath: '/tmp/result.json',
    rounds: 30,
    expectedText: 'asd',
  }

  const mode = await bootstrapTerminalApp(
    { render },
    {
      loadConfig: vi.fn().mockResolvedValue(null),
      loadSmokeRoot: vi.fn(),
      loadProbeConfig: vi.fn().mockResolvedValue(probeConfig),
      loadProbeRoot: vi.fn().mockResolvedValue(ProbeRoot),
      loadApp,
    },
  )

  expect(mode).toBe('probe')
  expect(loadApp).not.toHaveBeenCalled()
  expect(render.mock.calls[0][0].type).toBe(ProbeRoot)
  expect(render.mock.calls[0][0].props.config).toEqual(probeConfig)
})

it('loads the normal application when Rust returns no smoke or probe config', async () => {
  const render = vi.fn()
  const App: ComponentType = () => null
  const loadSmokeRoot = vi.fn()
  const loadProbeRoot = vi.fn()

  const mode = await bootstrapTerminalApp(
    { render },
    {
      loadConfig: vi.fn().mockResolvedValue(null),
      loadSmokeRoot,
      loadProbeConfig: vi.fn().mockResolvedValue(null),
      loadProbeRoot,
      loadApp: vi.fn().mockResolvedValue(App),
    },
  )

  expect(mode).toBe('app')
  expect(loadSmokeRoot).not.toHaveBeenCalled()
  expect(loadProbeRoot).not.toHaveBeenCalled()
  expect(render.mock.calls[0][0].type).toBe(App)
})

it('reports bootstrap failures through the Rust smoke finalizer', async () => {
  const submit = vi.fn().mockResolvedValue(undefined)

  await reportTerminalSmokeBootstrapFailure(
    new Error('smoke root import failed'),
    submit,
  )

  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({
      ok: false,
      stage: 'mounting',
      error: 'smoke root import failed',
    }),
  )
})
