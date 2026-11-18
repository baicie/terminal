import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
describe('fake timer date', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })
  it('advanceTimersByTime advances Date.now', () => {
    const a = Date.now()
    vi.advanceTimersByTime(60_000)
    console.log(JSON.stringify({ delta: Date.now() - a }))
    expect(Date.now() - a).toBe(60_000)
  })
})
