import { beforeEach, expect, it, vi } from 'vitest'

const database = vi.hoisted(() => ({
  execute: vi.fn(),
  load: vi.fn(),
  select: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: database.load },
}))

beforeEach(() => {
  vi.resetModules()
  database.execute.mockReset()
  database.load.mockReset().mockResolvedValue(database)
  database.select.mockReset()
})

it('retries after a failed schema init instead of caching the bare connection', async () => {
  database.execute.mockRejectedValueOnce(new Error('create table hosts failed'))
  const { getDb } = await import('./connection')

  await expect(getDb()).rejects.toThrow('create table hosts failed')
  expect(database.load).toHaveBeenCalledTimes(1)

  database.execute.mockResolvedValue(undefined)
  await expect(getDb()).resolves.toBe(database)
  expect(database.load).toHaveBeenCalledTimes(2)
})
