import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  allowStartup,
  beginStartupGate,
  blockStartup,
  resetStartupGateForTests,
} from './startup-gate'

const coreState = vi.hoisted(() => ({ runtimeLockHeld: true }))
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: async (command: string) =>
    command === 'runtime_instance_lock_held' ? coreState.runtimeLockHeld : true,
}))
vi.mock('@tauri-apps/plugin-sql', () => {
  const database = {
    execute: vi.fn(async () => undefined),
    select: vi.fn(async () => []),
  }
  return { default: { load: vi.fn(async () => database) } }
})
vi.mock('./connection-schema-core', () => ({
  initializeCoreSchema: vi.fn(async () => undefined),
}))
vi.mock('./connection-schema-team', () => ({
  initializeTeamSchema: vi.fn(async () => undefined),
}))

import { getDb, select } from './connection'


describe('database startup gate at the connection layer', () => {
  beforeEach(() => {
    resetStartupGateForTests()
    coreState.runtimeLockHeld = true
  })

  it('refuses the database when the runtime instance lock is not held', async () => {
    allowStartup()
    coreState.runtimeLockHeld = false
    await expect(getDb()).rejects.toThrow(/runtime instance lock/)
    await expect(getDb()).rejects.toThrow(/blocked/)
  })

  it('refuses a cached connection once the gate becomes pending', async () => {
    allowStartup()
    await getDb()
    beginStartupGate()
    await expect(getDb()).rejects.toThrow(/blocked/)
  })

  it('refuses a cached connection once the gate is blocked', async () => {
    allowStartup()
    await getDb()
    blockStartup()
    await expect(getDb()).rejects.toThrow(/blocked/)
  })

  it('propagates a gate rejection from select instead of returning []', async () => {
    allowStartup()
    blockStartup()
    await expect(select('SELECT 1')).rejects.toThrow(/blocked/)
  })

  it('still returns [] for an ordinary query error', async () => {
    allowStartup()
    const plugin = await import('@tauri-apps/plugin-sql')
    const loaded = await plugin.default.load('sqlite:terminal.db')
    ;(loaded.select as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('no such table'),
    )
    await expect(select('SELECT * FROM missing')).resolves.toEqual([])
  })
})
