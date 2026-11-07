import { describe, expect, it } from 'vitest'
import { isLegacyTimestampCursor, LEGACY_TIMESTAMP_VERSION } from './sync-protocol'

describe('isLegacyTimestampCursor', () => {
  it('recognises the millisecond cursors historical clients send', () => {
    expect(isLegacyTimestampCursor(Date.now())).toBe(true)
    expect(isLegacyTimestampCursor(String(Date.now()))).toBe(true)
    expect(isLegacyTimestampCursor(LEGACY_TIMESTAMP_VERSION)).toBe(true)
  })

  it('leaves composite cursors and small legacy transaction ids alone', () => {
    expect(isLegacyTimestampCursor('2.00000000000000000001.00000000000000000002.00000000000000000000')).toBe(false)
    expect(isLegacyTimestampCursor(LEGACY_TIMESTAMP_VERSION - 1)).toBe(false)
    expect(isLegacyTimestampCursor(0)).toBe(false)
    expect(isLegacyTimestampCursor(undefined)).toBe(false)
    expect(isLegacyTimestampCursor('')).toBe(false)
    expect(isLegacyTimestampCursor('12ab')).toBe(false)
  })
})
