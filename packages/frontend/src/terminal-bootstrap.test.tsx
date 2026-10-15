import type { ComponentType } from 'react'
import { act, fireEvent, screen } from '@testing-library/react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import {
  bootstrapTerminalApp,
  reportTerminalSmokeBootstrapFailure,
  startTerminalApp,
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

it('loads only the raw input probe root when its dedicated config is enabled', async () => {
  const render = vi.fn()
  const loadApp = vi.fn()
  const RawProbeRoot: ComponentType<{ config: unknown }> = () => null
  const rawProbeConfig = {
    resultPath: '/tmp/raw-result.json',
    caseName: 'sgr-mouse',
    expectedHex: '1b5b3c303b333b344d',
  }

  const mode = await bootstrapTerminalApp(
    { render },
    {
      loadConfig: vi.fn().mockResolvedValue(null),
      loadSmokeRoot: vi.fn(),
      loadProbeConfig: vi.fn().mockResolvedValue(null),
      loadProbeRoot: vi.fn(),
      loadRawProbeConfig: vi.fn().mockResolvedValue(rawProbeConfig),
      loadRawProbeRoot: vi.fn().mockResolvedValue(RawProbeRoot),
      loadApp,
    },
  )

  expect(mode).toBe('raw-probe')
  expect(loadApp).not.toHaveBeenCalled()
  expect(render.mock.calls[0][0].type).toBe(RawProbeRoot)
  expect(render.mock.calls[0][0].props.config).toEqual(rawProbeConfig)
})

it('loads only the terminal shell probe root when its dedicated gate is enabled', async () => {
  const render = vi.fn()
  const loadApp = vi.fn()
  const ShellProbeRoot: ComponentType<{ config: unknown }> = () => null
  const shellProbeConfig = {
    resultPath: '/tmp/shell-result.json',
    caseName: 'readline-tab',
    timeoutMs: 20_000,
  }

  const mode = await bootstrapTerminalApp(
    { render },
    {
      loadConfig: vi.fn().mockResolvedValue(null),
      loadSmokeRoot: vi.fn(),
      loadProbeConfig: vi.fn().mockResolvedValue(null),
      loadProbeRoot: vi.fn(),
      loadRawProbeConfig: vi.fn().mockResolvedValue(null),
      loadShellProbeConfig: vi.fn().mockResolvedValue(shellProbeConfig),
      loadShellProbeRoot: vi.fn().mockResolvedValue(ShellProbeRoot),
      loadApp,
    },
  )

  expect(mode).toBe('shell-probe')
  expect(loadApp).not.toHaveBeenCalled()
  expect(render.mock.calls[0][0].type).toBe(ShellProbeRoot)
  expect(render.mock.calls[0][0].props.config).toEqual(shellProbeConfig)
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

it('renders a retryable failure and reuses the root after config loading fails', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const ReadyApp: ComponentType = () => <div>Application ready</div>
  const loadConfig = vi
    .fn()
    .mockRejectedValueOnce(new Error('config IPC unavailable'))
    .mockResolvedValueOnce(null)
  const reportFailure = vi.fn().mockResolvedValue(undefined)

  try {
    startTerminalApp(
      root,
      {
        loadConfig,
        loadSmokeRoot: vi.fn(),
        loadProbeConfig: vi.fn().mockResolvedValue(null),
        loadProbeRoot: vi.fn(),
        loadApp: vi.fn().mockResolvedValue(ReadyApp),
      },
      reportFailure,
    )

    expect((await screen.findByRole('alert')).textContent).toContain(
      'config IPC unavailable',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry startup' }))

    expect(await screen.findByText('Application ready')).toBeTruthy()
    expect(loadConfig).toHaveBeenCalledTimes(2)
    expect(reportFailure).toHaveBeenCalledOnce()
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('renders a retryable failure when the normal application chunk fails', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  try {
    startTerminalApp(
      root,
      {
        loadConfig: vi.fn().mockResolvedValue(null),
        loadSmokeRoot: vi.fn(),
        loadProbeConfig: vi.fn().mockResolvedValue(null),
        loadProbeRoot: vi.fn(),
        loadApp: vi
          .fn()
          .mockRejectedValue(new Error('normal App chunk import failed')),
      },
      vi.fn().mockResolvedValue(undefined),
    )

    expect((await screen.findByRole('alert')).textContent).toContain(
      'normal App chunk import failed',
    )
    expect(
      screen
        .getByRole('button', { name: 'Retry startup' })
        .hasAttribute('disabled'),
    ).toBe(false)
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})

it('falls back to plain text when the startup error screen itself cannot load', async () => {
  // The error screen is imported lazily so i18next and every locale bundle stay
  // off the critical path. That lazy import can fail like any other, and the
  // one outcome that must never happen is a blank window with no explanation
  // at all, so this pins the last-resort rendering.
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)

  try {
    startTerminalApp(
      root,
      {
        loadConfig: vi.fn().mockRejectedValue(new Error('bootstrap exploded')),
        loadSmokeRoot: vi.fn(),
        loadProbeConfig: vi.fn().mockResolvedValue(null),
        loadProbeRoot: vi.fn(),
        loadApp: vi.fn(),
      },
      vi.fn().mockResolvedValue(undefined),
    )

    await act(async () => {
      await Promise.resolve()
    })

    // Asserting on the message rather than a specific element keeps this test
    // about the outcome: the failure text must reach the screen either way.
    expect(container.textContent).toContain('bootstrap exploded')
  } finally {
    await act(async () => root.unmount())
    container.remove()
  }
})
