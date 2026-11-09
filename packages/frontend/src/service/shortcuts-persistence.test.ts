// Shortcut bindings must survive a restart, refuse collisions and never be lost
// by a failed write going unnoticed.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ShortcutsService,
  memoryOnlyShortcutStorage,
} from './shortcuts'
import type { ShortcutStorage } from './shortcuts'
import { defaultShortcuts as sharedDefaults } from './shortcut-defaults'

// The service deep-copies the defaults, but this file must not rely on that when
// asserting: it reads the pristine values once, before any service mutates state.
const defaultShortcuts = JSON.parse(JSON.stringify(sharedDefaults)) as Shortcut[]
import type { Shortcut } from './shortcut-types'

class FakeStorage implements ShortcutStorage {
  saved: Shortcut[] | null = null
  loads = 0
  saveError: Error | null = null
  loadError: Error | null = null

  async load(): Promise<Shortcut[] | null> {
    this.loads += 1
    if (this.loadError) throw this.loadError
    return this.saved === null ? null : JSON.parse(JSON.stringify(this.saved))
  }

  async save(shortcuts: Shortcut[]): Promise<void> {
    if (this.saveError) throw this.saveError
    this.saved = JSON.parse(JSON.stringify(shortcuts))
  }
}

function serviceWithStorage(storage: ShortcutStorage): ShortcutsService {
  const service = new ShortcutsService()
  service.useStorage(storage)
  return service
}

let storage: FakeStorage

beforeEach(() => {
  storage = new FakeStorage()
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('hydration', () => {
  it('keeps the defaults when nothing is stored', async () => {
    const service = serviceWithStorage(storage)
    await service.hydrate()
    expect(service.getShortcuts()).toEqual(defaultShortcuts)
  })

  it('restores a stored binding (survives restart)', async () => {
    const first = serviceWithStorage(storage)
    const target = first.getShortcuts()[0]
    first.updateShortcut(target.id, { keys: ['Meta', 'Shift', 'k'] })
    // Let the fire-and-forget persist settle.
    await Promise.resolve()
    await Promise.resolve()

    const restarted = serviceWithStorage(storage)
    await restarted.hydrate()
    expect(restarted.getShortcutByAction(target.action)?.keys).toEqual([
      'Meta',
      'Shift',
      'k',
    ])
  })

  it('falls back to defaults when storage throws on load', async () => {
    storage.loadError = new Error('db unavailable')
    const service = serviceWithStorage(storage)
    await service.hydrate()
    expect(service.getShortcuts()).toEqual(defaultShortcuts)
  })

  it('does not let a slow load overwrite a change made while it ran', async () => {
    let releaseLoad: () => void = () => undefined
    const slow: ShortcutStorage = {
      load: () =>
        new Promise<Shortcut[]>(resolve => {
          releaseLoad = () => resolve([])
        }),
      save: async () => undefined,
    }
    const service = serviceWithStorage(slow)
    const hydrating = service.hydrate()
    const target = service.getShortcuts()[0]
    service.updateShortcut(target.id, { keys: ['Meta', 'Shift', 'x'] })
    releaseLoad()
    await hydrating
    // The user's edit wins over the stale load.
    expect(service.getShortcutByAction(target.action)?.keys).toEqual([
      'Meta',
      'Shift',
      'x',
    ])
  })
})

describe('conflicts', () => {
  it('refuses a key set already bound to another enabled shortcut', () => {
    const service = serviceWithStorage(storage)
    const [first, second] = service.getShortcuts()
    expect(service.updateShortcut(second.id, { keys: first.keys })).toBe(false)
    expect(service.getShortcutByAction(second.action)?.keys).toEqual(second.keys)
  })

  it('allows reusing keys held by a disabled shortcut', () => {
    const service = serviceWithStorage(storage)
    const [first, second] = service.getShortcuts()
    service.updateShortcut(first.id, { enabled: false })
    expect(service.updateShortcut(second.id, { keys: first.keys })).toBe(true)
  })

  it('never silently overwrites: a refused change is not persisted', async () => {
    const service = serviceWithStorage(storage)
    const [first, second] = service.getShortcuts()
    service.updateShortcut(second.id, { keys: first.keys })
    await Promise.resolve()
    expect(storage.saved).toBeNull()
  })
})

describe('reset and export', () => {
  it('restores defaults and persists them', async () => {
    const service = serviceWithStorage(storage)
    const target = service.getShortcuts()[0]
    service.updateShortcut(target.id, { keys: ['Meta', 'Shift', 'z'] })
    service.resetToDefault()
    await Promise.resolve()
    await Promise.resolve()
    expect(service.getShortcuts()).toEqual(defaultShortcuts)
    const restarted = serviceWithStorage(storage)
    await restarted.hydrate()
    // Compare the bindings themselves; description/etc. may be carried from the
    // stored copy, which is not what this test is about.
    expect(restarted.getShortcuts().map(s => [s.id, s.keys, s.enabled])).toEqual(
      defaultShortcuts.map(s => [s.id, s.keys, s.enabled]),
    )
  })

  it('exports every binding, including disabled ones', () => {
    const service = serviceWithStorage(storage)
    const parsed = JSON.parse(service.exportShortcuts()) as Shortcut[]
    expect(parsed).toHaveLength(defaultShortcuts.length)
  })

  it('imports a valid export and rejects a malformed one', () => {
    const service = serviceWithStorage(storage)
    const source = serviceWithStorage(storage)
    const target = source.getShortcuts()[0]
    source.updateShortcut(target.id, { keys: ['Meta', 'Shift', 'q'] })

    expect(service.importShortcuts(source.exportShortcuts())).toBe(true)
    expect(service.getShortcutByAction(target.action)?.keys).toEqual([
      'Meta',
      'Shift',
      'q',
    ])

    const before = service.getShortcuts()
    expect(service.importShortcuts('{"not":"an array"}')).toBe(false)
    expect(service.importShortcuts('[{"id":1}]')).toBe(false)
    expect(service.getShortcuts()).toEqual(before)
  })
})

describe('memory-only fallback', () => {
  it('still works when no storage is attached', async () => {
    const service = new ShortcutsService()
    service.useStorage(memoryOnlyShortcutStorage)
    await service.hydrate()
    expect(service.getShortcuts()).toEqual(defaultShortcuts)
  })
})
