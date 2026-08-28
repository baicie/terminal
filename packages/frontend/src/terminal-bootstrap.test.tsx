import type { ComponentType } from 'react'
import { expect, it, vi } from 'vitest'
import {
  bootstrapTerminalApp,
  reportTerminalSmokeBootstrapFailure,
} from './terminal-bootstrap'
import type { TerminalSmokeConfig } from './features/terminal/smoke/terminal-smoke-contract'
import { terminalSmokeTestConfig } from './features/terminal/smoke/terminal-smoke-test-fixtures'

const config = terminalSmokeTestConfig

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

it('loads the normal application when Rust returns no smoke config', async () => {
  const render = vi.fn()
  const App: ComponentType = () => null
  const loadSmokeRoot = vi.fn()

  const mode = await bootstrapTerminalApp(
    { render },
    {
      loadConfig: vi.fn().mockResolvedValue(null),
      loadSmokeRoot,
      loadApp: vi.fn().mockResolvedValue(App),
    },
  )

  expect(mode).toBe('app')
  expect(loadSmokeRoot).not.toHaveBeenCalled()
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
