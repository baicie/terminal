/**
 * Tests for port-forward-rules database operations
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('./connection', () => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
}))

import { executeQuery, select } from './connection'
import {
  getPortForwardRules,
  getPortForwardRulesByHost,
  createPortForwardRule,
  updatePortForwardRule,
  deletePortForwardRule,
} from './port-forward-rules'

const { executeQuery: eq, select: sel } = vi.mocked({ executeQuery, select })

describe('getPortForwardRules', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns all rules ordered by created_at desc', async () => {
    const rows = [
      { id: 'pf-1', name: 'Local DB', type: 'local', local_host: '127.0.0.1', local_port: 5432, remote_host: 'db.internal', remote_port: 5432, host_id: null, enabled: 1, created_at: 1000, updated_at: 1000 },
    ]
    sel.mockResolvedValue(rows as never)

    const result = await getPortForwardRules()

    expect(sel).toHaveBeenCalledWith(
      expect.stringContaining('ORDER BY created_at DESC'),
    )
    expect(result).toEqual(rows)
  })
})

describe('getPortForwardRulesByHost', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters by host_id', async () => {
    sel.mockResolvedValue([] as never)

    await getPortForwardRulesByHost('host-abc')

    expect(sel).toHaveBeenCalledWith(
      expect.stringContaining('WHERE host_id ='),
      ['host-abc'],
    )
  })
})

describe('createPortForwardRule', () => {
  beforeEach(() => vi.clearAllMocks())

  it('inserts a complete rule record', async () => {
    eq.mockResolvedValue({ rowsAffected: 1 } as never)

    await createPortForwardRule({
      id: 'pf-test',
      name: 'Test Forward',
      type: 'local',
      local_host: '127.0.0.1',
      local_port: 8080,
      remote_host: 'web.internal',
      remote_port: 80,
      host_id: 'host-1',
      enabled: 1,
    })

    expect(eq).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO port_forward_rules'),
      expect.arrayContaining(['pf-test', 'Test Forward', 'local', '127.0.0.1', 8080, 'web.internal', 80, 'host-1', 1]),
    )
  })

  it('passes null for host_id when omitted', async () => {
    eq.mockResolvedValue({ rowsAffected: 1 } as never)

    await createPortForwardRule({
      id: 'pf-orphan',
      name: 'Standalone',
      type: 'dynamic',
      local_host: '0.0.0.0',
      local_port: 1080,
      remote_host: 'proxy.internal',
      remote_port: 1080,
      host_id: null as never,
      enabled: 0,
    })

    const call = eq.mock.calls[0]
    expect(call[1]).toContain(null) // host_id position
  })
})

describe('updatePortForwardRule', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates only provided fields', async () => {
    eq.mockResolvedValue({ rowsAffected: 1 } as never)

    await updatePortForwardRule('pf-1', { name: 'Renamed', enabled: 0 })

    expect(eq).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE port_forward_rules SET'),
      expect.arrayContaining(['Renamed', 0]),
    )
    expect(eq.mock.calls[0][0].split(',')).toHaveLength(3) // name + enabled + updated_at
  })

  it('sets host_id to null when explicitly passed', async () => {
    eq.mockResolvedValue({ rowsAffected: 1 } as never)

    await updatePortForwardRule('pf-1', { host_id: null })

    const [sql, params] = eq.mock.calls[0]
    expect(sql).toContain('host_id = ?')
    expect(params).toContain(null)
  })
})

describe('deletePortForwardRule', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes by id', async () => {
    eq.mockResolvedValue({ rowsAffected: 1 } as never)

    await deletePortForwardRule('pf-xyz')

    expect(eq).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM port_forward_rules WHERE id'),
      ['pf-xyz'],
    )
  })
})
