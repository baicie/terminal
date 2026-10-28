import { expect, it, vi } from 'vitest'
import { loadBootstrapConfig } from './terminal-bootstrap-deadline'

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
