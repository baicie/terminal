import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ executeQuery: vi.fn() }))

vi.mock('./connection', () => ({
  executeQuery: mocks.executeQuery,
  select: vi.fn(async () => []),
}))

import { removeUnauthorizedTeamShares } from './teams'

beforeEach(() => {
  mocks.executeQuery.mockReset()
})

describe('removeUnauthorizedTeamShares scope', () => {
  it('only deletes acknowledged cloud rows from the same endpoint', async () => {
    await removeUnauthorizedTeamShares(['team-a'], 'https://team.example.com')

    const [sql, params] = mocks.executeQuery.mock.calls[0]
    expect(sql).toContain("mode = 'cloud'")
    expect(sql).toContain('dirty = 0')
    expect(sql).toContain('version IS NOT NULL')
    expect(sql).toContain('endpoint = ?')
    expect(params).toEqual(['https://team.example.com', 'team-a'])
  })

  it('never touches local teams even when the server authorizes nothing', async () => {
    await removeUnauthorizedTeamShares([], 'https://team.example.com')

    const [sql, params] = mocks.executeQuery.mock.calls[0]
    expect(sql).toContain("mode = 'cloud'")
    expect(sql).not.toContain('NOT IN')
    expect(params).toEqual(['https://team.example.com'])
  })
})
