import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseHostIds } from './parse-host-ids'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('parseHostIds', () => {
  it('returns the ids of a valid JSON array unchanged', () => {
    expect(parseHostIds('["host-1","host-2"]')).toEqual(['host-1', 'host-2'])
    expect(parseHostIds('[]')).toEqual([])
  })

  it('returns an empty list for malformed JSON instead of throwing', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(() => parseHostIds('["host-1"')).not.toThrow()
    expect(parseHostIds('["host-1"')).toEqual([])
    expect(parseHostIds('not json at all')).toEqual([])
  })

  it('returns an empty list when the payload is valid JSON but not an array', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseHostIds('{"host-1":true}')).toEqual([])
    expect(parseHostIds('"host-1"')).toEqual([])
    expect(parseHostIds('42')).toEqual([])
    expect(parseHostIds('null')).toEqual([])
  })

  it('treats empty and missing values as no hosts', () => {
    expect(parseHostIds('')).toEqual([])
    expect(parseHostIds(null)).toEqual([])
    expect(parseHostIds(undefined)).toEqual([])
  })
})

describe('parseHostIds diagnostics', () => {
  it('warns once with the reason and a sample of the malformed value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseHostIds('["host-1"')).toEqual([])

    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0][0])
    expect(message).toContain('[parseHostIds]')
    expect(message).toContain('invalid JSON')
    expect(message).toContain('host-1')
  })

  it('warns once when the payload decodes to a non-array', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(parseHostIds('{"host-1":true}')).toEqual([])

    expect(warn).toHaveBeenCalledTimes(1)
    const message = String(warn.mock.calls[0][0])
    expect(message).toContain('not an array')
    expect(message).toContain('host-1')
  })

  it('stays silent for valid and empty payloads', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    parseHostIds('["host-1","host-2"]')
    parseHostIds('[]')
    parseHostIds('')
    parseHostIds(null)
    parseHostIds(undefined)

    expect(warn).not.toHaveBeenCalled()
  })
})
