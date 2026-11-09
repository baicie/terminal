// Only the last edit may survive. Concurrent fire-and-forget saves let an earlier
// (slower) write land after a later one, so the database could hold a binding the
// user already changed away from.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ShortcutsService } from './shortcuts'
import type { ShortcutStorage } from './shortcuts'
import type { Shortcut } from './shortcut-types'

/** Storage whose saves complete in whatever order the test decides. */
class OrderedStorage implements ShortcutStorage {
  saved: Shortcut[] | null = null
  readonly pending: Array<{ shortcuts: Shortcut[], release: () => void }> = []
  /** When false, saves resolve immediately in call order. */
  manual = false
  loadResult: Shortcut[] | null = null
  failNext = false

  async load(): Promise<Shortcut[] | null> {
    return this.loadResult
  }

  async save(shortcuts: Shortcut[]): Promise<void> {
    if (this.failNext) {
      this.failNext = false
      throw new Error('sqlite is read-only')
    }
    if (!this.manual) {
      this.saved = JSON.parse(JSON.stringify(shortcuts))
      return
    }
    await new Promise<void>(resolve => {
      this.pending.push({
        shortcuts: JSON.parse(JSON.stringify(shortcuts)),
        release: resolve,
      })
    })
    this.saved = JSON.parse(JSON.stringify(shortcuts))
  }

  releaseLast(): void {
    const entry = this.pending.pop()
    entry?.release()
  }

  releaseFirst(): void {
    const entry = this.pending.shift()
    entry?.release()
  }
}

let storage: OrderedStorage
let service: ShortcutsService

function setup(): void {
  storage = new OrderedStorage()
  service = new ShortcutsService()
  service.useStorage(storage)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

beforeEach(setup)

const flush = async () => {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}

describe('write ordering', () => {
  it('a single edit is saved', async () => {
    await service.hydrate()
    const target = service.getShortcuts()[0]
    service.updateShortcut(target.id, { keys: ['Meta', 'Shift', 'A'] })
    await flush()
    expect(storage.saved?.find(s => s.id === target.id)?.keys).toEqual([
      'Meta',
      'Shift',
      'A',
    ])
  })

  it('ten rapid edits leave the last one in storage', async () => {
    await service.hydrate()
    const target = service.getShortcuts()[0]
    for (let i = 0; i < 10; i += 1) {
      service.updateShortcut(target.id, { keys: ['Meta', `${i}`] })
    }
    await flush()
    expect(storage.saved?.find(s => s.id === target.id)?.keys).toEqual(['Meta', '9'])
  })

  it('a slow first save cannot be overtaken by a later one', async () => {
    storage.manual = true
    await service.hydrate()
    const target = service.getShortcuts()[0]

    service.updateShortcut(target.id, { keys: ['Meta', 'FIRST'] })
    await flush()
    // The first write is in flight and has not been released yet.
    expect(storage.pending).toHaveLength(1)

    // A second edit while the first is still saving must queue behind it rather
    // than start a second concurrent write that could land first.
    service.updateShortcut(target.id, { keys: ['Meta', 'SECOND'] })
    await flush()
    expect(storage.pending).toHaveLength(1)

    storage.releaseFirst()
    await flush()
    // Now the queued write runs, and it carries the latest state.
    expect(storage.pending).toHaveLength(1)
    storage.releaseFirst()
    await flush()

    expect(storage.saved?.find(s => s.id === target.id)?.keys).toEqual([
      'Meta',
      'SECOND',
    ])
  })
})

describe('failure feedback', () => {
  it('reports a failed save instead of only logging it', async () => {
    await service.hydrate()
    const target = service.getShortcuts()[0]
    storage.failNext = true

    const state = service.getPersistState()
    service.updateShortcut(target.id, { keys: ['Meta', 'X'] })
    await flush()

    expect(service.getPersistState().status).toBe('failed')
    expect(service.getPersistState().error).toMatch(/read-only/)
    // The in-memory binding still reflects what the user chose.
    expect(service.getShortcutById(target.id)?.keys).toEqual(['Meta', 'X'])
    expect(state.status).not.toBe('failed')
  })

  it('clears the failed state after a successful retry', async () => {
    await service.hydrate()
    const target = service.getShortcuts()[0]
    storage.failNext = true
    service.updateShortcut(target.id, { keys: ['Meta', 'Y'] })
    await flush()
    expect(service.getPersistState().status).toBe('failed')

    service.updateShortcut(target.id, { keys: ['Meta', 'Z'] })
    await flush()
    expect(service.getPersistState().status).toBe('saved')
  })

  it('reports pending while a save is in flight', async () => {
    storage.manual = true
    await service.hydrate()
    const target = service.getShortcuts()[0]
    service.updateShortcut(target.id, { keys: ['Meta', 'P'] })
    await flush()
    expect(service.getPersistState().status).toBe('pending')
    storage.releaseFirst()
    await flush()
    expect(service.getPersistState().status).toBe('saved')
  })
})

describe('hydrate racing with an edit', () => {
  it('a late hydrate never overwrites an edit the user already made', async () => {
    let releaseLoad: (value: Shortcut[] | null) => void = () => undefined
    storage.load = () =>
      new Promise<Shortcut[] | null>(resolve => {
        releaseLoad = resolve
      })

    const hydrating = service.hydrate()
    const target = service.getShortcuts()[0]
    service.updateShortcut(target.id, { keys: ['Meta', 'EDITED'] })
    releaseLoad(null)
    await hydrating
    await flush()

    expect(service.getShortcutById(target.id)?.keys).toEqual(['Meta', 'EDITED'])
  })
})

describe('enable and disable', () => {
  it('toggling enabled changes what the matcher sees immediately', async () => {
    await service.hydrate()
    const target = service.getShortcuts()[0]
    service.updateShortcut(target.id, { enabled: false })
    expect(
      service.getEnabledShortcuts().some(shortcut => shortcut.id === target.id),
    ).toBe(false)
    service.updateShortcut(target.id, { enabled: true })
    expect(
      service.getEnabledShortcuts().some(shortcut => shortcut.id === target.id),
    ).toBe(true)
  })
})
