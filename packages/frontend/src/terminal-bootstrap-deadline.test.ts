import { expect, it, vi } from 'vitest'
import {
  loadBootstrapConfig,
  loadOptionalBootstrapConfigs,
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
