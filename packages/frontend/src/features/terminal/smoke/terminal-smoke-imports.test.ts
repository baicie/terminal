import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@baicie/xterm', () => ({ Terminal: class {} }))

afterEach(() => {
  vi.doUnmock('@/service/database')
  vi.doUnmock('@/router')
  vi.doUnmock('@/locales')
  vi.doUnmock('./terminal-smoke-contract')
  vi.resetModules()
})

it('loads the production terminal binding without evaluating the database graph', async () => {
  vi.resetModules()
  vi.doMock('@/service/database', () => {
    throw new Error('terminal smoke evaluated the database module')
  })
  vi.doMock('@/router', () => {
    throw new Error('terminal smoke evaluated the router module')
  })
  vi.doMock('@/locales', () => {
    throw new Error('terminal smoke evaluated the locales module')
  })
  vi.doMock('./terminal-smoke-contract', () => {
    throw new Error('terminal smoke evaluated the IPC contract module')
  })

  await expect(import('./terminal-smoke-root')).resolves.toHaveProperty(
    'default',
  )
})
