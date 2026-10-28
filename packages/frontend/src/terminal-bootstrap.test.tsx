import type { ComponentType } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import {
  bootstrapTerminalApp,
  reportTerminalSmokeBootstrapFailure,
} from './terminal-bootstrap'
import { renderStartupFailure } from './terminal-bootstrap-failure-ui'
import { startTerminalApp } from './terminal-bootstrap-start'
import { BOOTSTRAP_APP_DEADLINE_MS } from './terminal-bootstrap-deadline'
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
    nonce: 'shell_test_nonce',
    dialect: 'posix',
    ssh: null,
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

it('passes the attempt deadline to the normal App as its fallback timestamp', async () => {
  const render = vi.fn()
  const App: ComponentType<{ startupTerminalFallbackAt?: number }> = () => null
  const startupDeadlineAt = performance.now() + BOOTSTRAP_APP_DEADLINE_MS

  await expect(
    bootstrapTerminalApp(
      { render },
      {
        loadConfig: vi.fn().mockResolvedValue(null),
        loadSmokeRoot: vi.fn(),
        loadProbeConfig: vi.fn().mockResolvedValue(null),
        loadProbeRoot: vi.fn(),
        loadApp: vi.fn().mockResolvedValue(App),
      },
      undefined,
      startupDeadlineAt,
    ),
  ).resolves.toBe('app')

  expect(render.mock.calls[0][0].props.startupTerminalFallbackAt).toBe(
    startupDeadlineAt,
  )
})

it('mounts the normal app when probe config IPC never settles and observes late rejection', async () => {
  const render = vi.fn()
  const App: ComponentType = () => null
  let rejectConfig: (error: Error) => void = () => undefined
  const loadConfig = vi.fn().mockResolvedValue(null)
  const loadRemotePromptProbeConfig = vi.fn().mockResolvedValue(null)
  const loadRawProbeConfig = vi.fn().mockResolvedValue(null)
  const loadShellProbeConfig = vi.fn().mockResolvedValue(null)
  const loadProbeConfig = vi.fn(
    () =>
      new Promise<null>((_resolve, reject) => {
        rejectConfig = reject
      }),
  )

  const startup = bootstrapTerminalApp(
    { render },
    {
      loadConfig,
      loadRemotePromptProbeConfig,
      loadProbeConfig,
      loadProbeRoot: vi.fn(),
      loadRawProbeConfig,
      loadShellProbeConfig,
      loadApp: vi.fn().mockResolvedValue(App),
      loadSmokeRoot: vi.fn(),
    },
  )
  await expect(startup).resolves.toBe('app')
  expect(render.mock.calls[0][0].type).toBe(App)
  expect(loadProbeConfig).toHaveBeenCalledOnce()
  expect(loadRawProbeConfig).not.toHaveBeenCalled()
  expect(loadShellProbeConfig).not.toHaveBeenCalled()

  rejectConfig(new Error('late IPC rejection'))
  await Promise.resolve()
})

it('fails a probe root loader that never settles instead of keeping the window blank', async () => {
  vi.useFakeTimers()
  const render = vi.fn()
  const loadSmokeRoot = vi
    .fn()
    .mockImplementation(() => new Promise<ComponentType>(() => undefined))
  const startup = bootstrapTerminalApp(
    { render },
    {
      loadConfig: vi.fn().mockResolvedValue(config),
      loadSmokeRoot,
      loadProbeConfig: vi.fn().mockResolvedValue(null),
      loadProbeRoot: vi.fn(),
      loadApp: vi.fn(),
      rootLoadTimeoutMs: 50,
    },
  )
  const observedStartup = expect(startup).rejects.toThrow(
    'terminal smoke UI module did not load before its bootstrap deadline',
  )

  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
  expect(loadSmokeRoot).toHaveBeenCalledOnce()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(50)
  })
  await observedStartup
  expect(render).not.toHaveBeenCalled()
  vi.useRealTimers()
})

it('shares one absolute startup deadline across optional probes and the App loader', async () => {
  vi.useFakeTimers()
  const render = vi.fn()
  const loadApp = vi
    .fn()
    .mockImplementation(() => new Promise<ComponentType>(() => undefined))
  const startup = bootstrapTerminalApp(
    { render },
    {
      loadConfig: vi.fn().mockResolvedValue(null),
      loadRemotePromptProbeConfig: vi.fn(
        () => new Promise<null>(() => undefined),
      ),
      loadProbeConfig: vi.fn().mockResolvedValue(null),
      loadProbeRoot: vi.fn(),
      loadRawProbeConfig: vi.fn().mockResolvedValue(null),
      loadShellProbeConfig: vi.fn().mockResolvedValue(null),
      loadApp,
      loadSmokeRoot: vi.fn(),
    },
  )
  const observedStartup = expect(startup).rejects.toThrow(
    'normal application module did not load before its bootstrap deadline',
  )

  await act(async () => {
    await vi.advanceTimersByTimeAsync(BOOTSTRAP_APP_DEADLINE_MS - 1)
  })
  expect(loadApp).toHaveBeenCalledOnce()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1)
  })

  await observedStartup
  expect(render).not.toHaveBeenCalled()
  vi.useRealTimers()
})

it('does not render a late successful bootstrap after disposal', async () => {
  const render = vi.fn()
  const App: ComponentType = () => null
  let resolveApp: (app: ComponentType) => void = () => undefined
  const loadApp = vi.fn(
    () =>
      new Promise<ComponentType>(resolve => {
        resolveApp = resolve
      }),
  )
  const dispose = startTerminalApp(
    { render },
    {
      loadConfig: vi.fn().mockResolvedValue(null),
      loadSmokeRoot: vi.fn(),
      loadRemotePromptProbeConfig: vi.fn().mockResolvedValue(null),
      loadProbeConfig: vi.fn().mockResolvedValue(null),
      loadProbeRoot: vi.fn(),
      loadRawProbeConfig: vi.fn().mockResolvedValue(null),
      loadShellProbeConfig: vi.fn().mockResolvedValue(null),
      loadApp,
    },
    vi.fn().mockResolvedValue(undefined),
  )

  await waitFor(() => expect(loadApp).toHaveBeenCalledOnce())
  dispose()
  resolveApp(App)
  await new Promise<void>(resolve => setTimeout(resolve, 0))

  expect(render).not.toHaveBeenCalled()
})

it('renders a retryable failure when the normal application chunk never settles', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const RecoveredApp: ComponentType = () => <div>Recovered application</div>
  const LateApp: ComponentType = () => <div>Late application</div>
  let resolveLateApp: (app: ComponentType) => void = () => undefined
  const loadApp = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<ComponentType>(resolve => {
          resolveLateApp = resolve
        }),
    )
    .mockResolvedValueOnce(RecoveredApp)
  const dispose = startTerminalApp(
    root,
    {
      loadConfig: vi.fn().mockResolvedValue(null),
      loadSmokeRoot: vi.fn(),
      loadProbeConfig: vi.fn().mockResolvedValue(null),
      loadProbeRoot: vi.fn(),
      loadApp,
      appLoadTimeoutMs: 50,
    },
    vi.fn().mockResolvedValue(undefined),
  )

  try {
    expect((await screen.findByRole('alert')).textContent).toContain(
      'normal application module did not load before its bootstrap deadline',
    )
    expect(screen.getByRole('button', { name: 'Retry startup' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry startup' }))
    expect(await screen.findByText('Recovered application')).toBeTruthy()
    expect(loadApp).toHaveBeenCalledTimes(2)

    await act(async () => {
      resolveLateApp(LateApp)
    })
    expect(screen.getByText('Recovered application')).toBeTruthy()
    expect(screen.queryByText('Late application')).toBeNull()
  } finally {
    dispose()
    await act(async () => root.unmount())
    container.remove()
  }
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
  const dispose = startTerminalApp(
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

  try {
    expect((await screen.findByRole('alert')).textContent).toContain(
      'config IPC unavailable',
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry startup' }))

    expect(await screen.findByText('Application ready')).toBeTruthy()
    expect(loadConfig).toHaveBeenCalledTimes(2)
    expect(reportFailure).toHaveBeenCalledOnce()
  } finally {
    // Stop the lazy error chunk from rendering into an unmounted root.
    // The bootstrap disposer also invalidates a pending retry attempt.
    dispose()
    await act(async () => root.unmount())
    container.remove()
  }
})

it('renders a retryable failure when the normal application chunk fails', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const dispose = startTerminalApp(
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

  try {
    expect((await screen.findByRole('alert')).textContent).toContain(
      'normal App chunk import failed',
    )
    expect(
      screen
        .getByRole('button', { name: 'Retry startup' })
        .hasAttribute('disabled'),
    ).toBe(false)
  } finally {
    dispose()
    await act(async () => root.unmount())
    container.remove()
  }
})

it('ignores a second click on the previous attempt while Retry is loading', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const ReadyApp: ComponentType = () => <div>Application ready</div>
  let resolveApp: (app: ComponentType) => void = () => undefined
  const loadApp = vi.fn(
    () =>
      new Promise<ComponentType>(resolve => {
        resolveApp = resolve
      }),
  )
  const loadConfig = vi
    .fn()
    .mockRejectedValueOnce(new Error('initial bootstrap failed'))
    .mockResolvedValue(null)
  const dispose = startTerminalApp(
    root,
    {
      loadConfig,
      loadSmokeRoot: vi.fn(),
      loadProbeConfig: vi.fn().mockResolvedValue(null),
      loadProbeRoot: vi.fn(),
      loadApp,
    },
    vi.fn().mockResolvedValue(undefined),
  )

  try {
    const retry = await screen.findByRole('button', { name: 'Retry startup' })
    fireEvent.click(retry)
    await waitFor(() => expect(loadApp).toHaveBeenCalledOnce())
    fireEvent.click(retry)
    await act(async () => resolveApp(ReadyApp))
    expect(await screen.findByText('Application ready')).toBeTruthy()
    expect(loadApp).toHaveBeenCalledOnce()
  } finally {
    dispose()
    await act(async () => root.unmount())
    container.remove()
  }
})

it('keeps a retryable failure visible while the startup error screen loads', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const dispose = startTerminalApp(
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

  try {
    await act(async () => {
      await Promise.resolve()
    })

    // Asserting on the message rather than a specific element keeps this test
    // about the outcome: the failure text must reach the screen either way.
    expect(container.textContent).toContain('bootstrap exploded')
    expect(
      await screen.findByRole('button', { name: 'Retry startup' }),
    ).toBeTruthy()
  } finally {
    dispose()
    await act(async () => root.unmount())
    container.remove()
  }
})

it('re-renders the synchronous fallback when the startup error loader rejects', async () => {
  const render = vi.fn()
  const loadErrorScreen = vi
    .fn()
    .mockRejectedValue(new Error('startup error chunk unavailable'))
  const consoleError = vi
    .spyOn(console, 'error')
    .mockImplementation(() => undefined)

  try {
    renderStartupFailure(
      { render },
      new Error('bootstrap exploded'),
      vi.fn(),
      () => false,
      loadErrorScreen,
    )

    expect(render).toHaveBeenCalledOnce()
    await act(async () => {
      await Promise.resolve()
    })

    expect(loadErrorScreen).toHaveBeenCalledOnce()
    expect(render).toHaveBeenCalledTimes(2)
    expect(consoleError).toHaveBeenCalledWith(
      'Failed to load the startup error screen:',
      expect.objectContaining({ message: 'startup error chunk unavailable' }),
    )
  } finally {
    consoleError.mockRestore()
  }
})
