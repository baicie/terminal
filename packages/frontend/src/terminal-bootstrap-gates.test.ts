import { expect, it, vi } from 'vitest'
import { describeBootstrapGates } from './terminal-bootstrap-gates'
import { loadBootstrapGates } from './terminal-bootstrap-gate-loader'

it('starts every gate together even when the smoke read hangs', async () => {
  // The starvation bug in one line: queued, a hanging smoke read means the
  // optional gates are never invoked. They must be started regardless.
  vi.useFakeTimers()
  const invoked: string[] = []
  const pending = loadBootstrapGates(
    {
      smoke: () => {
        invoked.push('smoke')
        return new Promise<null>(() => undefined)
      },
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
    performance.now() + 30,
  )

  await vi.advanceTimersByTimeAsync(30)
  const gates = await pending

  expect(invoked.sort()).toEqual([
    'inputProbe',
    'rawProbe',
    'remotePrompt',
    'shellProbe',
    'smoke',
  ])
  expect(gates.smoke).toBeNull()
  expect(gates.optional.shellProbe).toBeNull()
  vi.useRealTimers()
})

it('reports a mode and every gate outcome on one line', () => {
  const line = describeBootstrapGates('app', [
    { gate: 'smoke', outcome: 'not-configured', elapsedMs: 3 },
    { gate: 'shellProbe', outcome: 'timed-out', elapsedMs: 1000 },
    { gate: 'inputProbe', outcome: 'errored', elapsedMs: 5, error: 'IPC down' },
  ])

  expect(line).toBe(
    'bootstrap mode=app gates: smoke=not-configured(3ms) '
    + 'shellProbe=timed-out(1000ms) inputProbe=errored(5ms)[IPC down]',
  )
})

it('never renders a configuration value', () => {
  // The report type carries no config object by construction; this pins the
  // rendering so a later "just log the config" change cannot slip through.
  const line = describeBootstrapGates('shell-probe', [
    { gate: 'shellProbe', outcome: 'loaded', elapsedMs: 12 },
  ])
  expect(line).toContain('shellProbe=loaded(12ms)')
  expect(line).not.toContain('token')
  expect(line).not.toContain('endpoint')
})
