import { expect, it, vi } from 'vitest'
import { initializeCoreSchema } from './connection-schema-core'

it('creates and migrates the host agent forwarding setting', async () => {
  const execute = vi.fn().mockResolvedValue(undefined)

  await initializeCoreSchema({ execute })

  const statements = execute.mock.calls.map(([sql]) => String(sql))
  expect(statements.some(sql => sql.includes('agent_forwarding INTEGER DEFAULT 0'))).toBe(true)
  expect(statements).toContain(
    'ALTER TABLE hosts ADD COLUMN agent_forwarding INTEGER DEFAULT 0',
  )
})
