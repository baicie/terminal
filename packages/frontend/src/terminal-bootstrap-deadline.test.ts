import { expect, it, vi } from 'vitest'
import {
  loadBootstrapConfig,
  loadOptionalBootstrapConfigs,
  type BootstrapConfigReport,
} from './terminal-bootstrap-deadline'

it('rejects a loader result that settles after its deadline before the timer runs', async () => {
  let now = 0
  let resolveLoader: (value: string) => void = () => undefined
  const pending = loadBootstrapConfig(
    () =>
      new Promise<string>(resolve => {
        resolveLoader = resolve
      }),
    50,
    undefined,
    () => now,
  )

  await Promise.resolve()
  now = 50
  resolveLoader('late config')

  await expect(pending).resolves.toBeNull()
})

it('cancels the strict deadline correction wait when the attempt is disposed', async () => {
  vi.useFakeTimers()
  let now = 0
  const controller = new AbortController()
  const pending = loadBootstrapConfig(
    () => new Promise<string>(() => undefined),
    10,
    controller.signal,
    () => now,
  )

  await vi.advanceTimersByTimeAsync(10)
  controller.abort(new Error('disposed'))

  await expect(pending).rejects.toThrow('disposed')
  now = 10
  vi.useRealTimers()
})

it('starts every optional config loader before any of them settles', async () => {
  // Regression: the loaders used to run in sequence against one absolute
  // deadline, so a slow first round-trip consumed the whole budget and the
  // ones behind it were never invoked -- the app silently fell back to normal
  // mode and the acceptance probe timed out instead of reporting why.
  const invoked: string[] = []
  const pending = loadOptionalBootstrapConfigs(
    {
      remotePrompt: () => {
        invoked.push('remotePrompt')
        return new Promise<null>(() => undefined)
      },
      inputProbe: () => {
        invoked.push('inputProbe')
        return new Promise<null>(() => undefined)
      },
      rawProbe: () => {
        invoked.push('rawProbe')
        return new Promise<null>(() => undefined)
      },
      shellProbe: () => {
        invoked.push('shellProbe')
        return new Promise<null>(() => undefined)
      },
    },
    performance.now() + 1_000,
  )

  // One macrotask is enough for every loader to have been called; a sequential
  // implementation would still be parked on the first unsettled promise.
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(invoked).toEqual([
    'remotePrompt',
    'inputProbe',
    'rawProbe',
    'shellProbe',
  ])
  void pending.catch(() => undefined)
})

it('still resolves a later optional loader when an earlier one hangs', async () => {
  vi.useFakeTimers()
  const shellProbe = vi.fn().mockResolvedValue('shell config')
  const pending = loadOptionalBootstrapConfigs(
    {
      remotePrompt: () => new Promise<null>(() => undefined),
      inputProbe: () => new Promise<null>(() => undefined),
      rawProbe: () => new Promise<null>(() => undefined),
      shellProbe,
    },
    performance.now() + 30,
  )

  await vi.advanceTimersByTimeAsync(30)
  await expect(pending).resolves.toEqual({
    remotePrompt: null,
    inputProbe: null,
    rawProbe: null,
    shellProbe: 'shell config',
  })
  expect(shellProbe).toHaveBeenCalledOnce()
  vi.useRealTimers()
})

// ---------------------------------------------------------------------------
// P9.3.1 P1-2：每一次 gate 读取都要留下结果记录，否则「探针没启用」与「探针
// 的 IPC 输给了预算」都是同一个 null，静默回落和正常启动无法区分。
// ---------------------------------------------------------------------------

it('records deadline-passed when the budget is gone before a gate is asked', async () => {
  const reports: BootstrapConfigReport[] = []
  const loader = vi.fn(async () => 'config')
  const now = () => 100
  const result = await loadBootstrapConfig(
    loader,
    100,
    undefined,
    now,
    report => reports.push(report),
    'shellProbe',
  )

  expect(result).toBeNull()
  // Never invoked: the gate did not run at all, which is not "not enabled".
  expect(loader).not.toHaveBeenCalled()
  expect(reports).toEqual([
    { gate: 'shellProbe', outcome: 'deadline-passed', elapsedMs: 0 },
  ])
})

it('records not-configured for a gate this build does not include', async () => {
  const reports: BootstrapConfigReport[] = []
  const result = await loadBootstrapConfig(
    undefined,
    1_000,
    undefined,
    () => 0,
    report => reports.push(report),
    'rawProbe',
  )

  expect(result).toBeNull()
  expect(reports[0]).toMatchObject({ gate: 'rawProbe', outcome: 'not-configured' })
})

it('records loaded and not-configured for gates that answered in time', async () => {
  const reports: BootstrapConfigReport[] = []
  const now = () => 0
  await loadBootstrapConfig(async () => ({ a: 1 }), 1_000, undefined, now, r => reports.push(r), 'inputProbe')
  await loadBootstrapConfig(async () => null, 1_000, undefined, now, r => reports.push(r), 'shellProbe')

  expect(reports.map(r => [r.gate, r.outcome])).toEqual([
    ['inputProbe', 'loaded'],
    ['shellProbe', 'not-configured'],
  ])
})

it('records timed-out for one hanging gate while the rest still load', async () => {
  vi.useFakeTimers()
  const reports: BootstrapConfigReport[] = []
  const loaded = vi.fn(async () => 'shell config')
  const pending = loadOptionalBootstrapConfigs(
    {
      // One gate never answers; the others must still be reported.
      remotePrompt: () => new Promise<null>(() => undefined),
      inputProbe: async () => null,
      rawProbe: async () => null,
      shellProbe: loaded,
    },
    performance.now() + 30,
    undefined,
    report => reports.push(report),
  )

  await vi.advanceTimersByTimeAsync(30)
  const result = await pending

  expect(result.shellProbe).toBe('shell config')
  expect(loaded).toHaveBeenCalledOnce()
  expect(reports.find(r => r.gate === 'remotePrompt')?.outcome).toBe('timed-out')
  expect(reports.find(r => r.gate === 'shellProbe')?.outcome).toBe('loaded')
  expect(reports.find(r => r.gate === 'inputProbe')?.outcome).toBe('not-configured')
  vi.useRealTimers()
})

it('records no secret when a gate rejects, only the message', async () => {
  const reports: BootstrapConfigReport[] = []
  const error = new Error('IPC unavailable for https://team.example.test token-opaque')
  await expect(
    loadBootstrapConfig(
      async () => {
        throw error
      },
      1_000,
      undefined,
      () => 0,
      report => reports.push(report),
      'remotePrompt',
    ),
  ).rejects.toThrow('IPC unavailable')

  expect(reports).toHaveLength(1)
  expect(reports[0].outcome).toBe('errored')
  // The message travels; the configuration that produced it never does.
  expect(reports[0].error).toContain('IPC unavailable')
})

it('records an abort as errored rather than leaving the gate unexplained', async () => {
  const reports: BootstrapConfigReport[] = []
  const controller = new AbortController()
  controller.abort(new Error('bootstrap disposed'))

  await expect(
    loadBootstrapConfig(
      async () => 'config',
      1_000,
      controller.signal,
      () => 0,
      report => reports.push(report),
      'smoke',
    ),
  ).rejects.toThrow('bootstrap disposed')

  expect(reports[0]).toMatchObject({ gate: 'smoke', outcome: 'errored' })
})
