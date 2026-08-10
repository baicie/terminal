import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ScriptRecord } from '@/service/database'
import { ScriptScheduler } from './script-scheduler'

function script(
  scheduleType: ScriptRecord['schedule_type'],
  scheduleValue: string | null,
): ScriptRecord {
  return {
    id: 'script-1',
    name: 'Scheduled script',
    description: null,
    script: 'whoami',
    host_ids: '[]',
    schedule_type: scheduleType,
    schedule_value: scheduleValue,
    enabled: 1,
    timeout_seconds: 60,
    retry_count: 0,
    created_at: 1,
    updated_at: 1,
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

it.each(['invalid', '-1', '999999999999']) (
  'does not register an unsafe interval value %s',
  value => {
    const scheduler = new ScriptScheduler(vi.fn())

    scheduler.start(script('interval', value))

    expect(vi.getTimerCount()).toBe(0)
  },
)

it('does not register an invalid cron expression', () => {
  const scheduler = new ScriptScheduler(vi.fn())

  scheduler.start(script('cron', '* *'))

  expect(vi.getTimerCount()).toBe(0)
})

it('does not overlap executions of the same scheduled script', async () => {
  let finish: (() => void) | undefined
  const execute = vi.fn(
    () => new Promise<void>(resolve => (finish = resolve)),
  )
  const scheduler = new ScriptScheduler(execute)
  scheduler.start(script('interval', '1000'))

  await vi.advanceTimersByTimeAsync(5000)
  expect(execute).toHaveBeenCalledTimes(1)

  finish?.()
  await Promise.resolve()
  await vi.advanceTimersByTimeAsync(1000)
  expect(execute).toHaveBeenCalledTimes(2)
})

it('handles scheduled execution rejection without an unhandled promise', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const scheduler = new ScriptScheduler(
    vi.fn().mockRejectedValue(new Error('private failure')),
  )
  scheduler.start(script('interval', '1000'))

  await vi.advanceTimersByTimeAsync(1000)

  expect(error).toHaveBeenCalledWith(
    '[ScriptScheduler] Scheduled script execution failed',
  )
  error.mockRestore()
})

it('matches comma-separated cron ranges with repeated whitespace', async () => {
  vi.setSystemTime(new Date(2026, 7, 10, 0, 3))
  const execute = vi.fn().mockResolvedValue(undefined)
  const scheduler = new ScriptScheduler(execute)

  scheduler.start(script('cron', '1-5,10  * * * *'))
  await vi.advanceTimersByTimeAsync(60_000)

  expect(execute).toHaveBeenCalledWith('script-1')
})
