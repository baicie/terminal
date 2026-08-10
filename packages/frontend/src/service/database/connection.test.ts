import { beforeEach, expect, it, vi } from 'vitest'
import { executeQuery, select } from './connection'

const database = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: { load: vi.fn(async () => database) },
}))

beforeEach(() => {
  database.execute.mockRejectedValue(new Error('database unavailable'))
  database.select.mockRejectedValue(new Error('database unavailable'))
})

it('never logs database query parameters when an operation fails', async () => {
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

  await expect(
    executeQuery('INSERT INTO hosts(password) VALUES (?)', [
      'private-write-secret',
    ]),
  ).rejects.toThrow('Database query failed')
  await select('SELECT * FROM hosts WHERE password = ?', [
    'private-read-secret',
  ])

  const logOutput = JSON.stringify(consoleError.mock.calls)
  expect(logOutput).not.toContain('private-write-secret')
  expect(logOutput).not.toContain('private-read-secret')
  consoleError.mockRestore()
})
