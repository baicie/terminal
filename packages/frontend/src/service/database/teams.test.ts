import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
}))

vi.mock('./connection', () => ({
  executeQuery: mocks.executeQuery,
  select: mocks.select,
}))

import { removeUnauthorizedTeamShares } from './teams'

beforeEach(() => {
  mocks.executeQuery.mockReset()
  mocks.select.mockReset()
})

describe('removeUnauthorizedTeamShares scope', () => {
  it('only deletes acknowledged cloud rows from the same endpoint', async () => {
    mocks.select.mockResolvedValue([
      { id: 'team-a', endpoint: 'https://team.example.com' },
      { id: 'team-b', endpoint: 'https://team.example.com' },
      { id: 'team-null', endpoint: null },
      { id: 'team-other', endpoint: 'https://other.example.com' },
    ])

    await removeUnauthorizedTeamShares(['team-a'], 'https://team.example.com')

    expect(mocks.select.mock.calls[0][0]).toContain("mode = 'cloud'")
    expect(mocks.executeQuery).toHaveBeenCalledTimes(2)
    const [sql, params] = mocks.executeQuery.mock.calls[0]
    expect(sql).toContain('team_shared_hosts')
    expect(sql).toContain('dirty = 0')
    expect(sql).toContain('version IS NOT NULL')
    expect(params).toEqual(['team-b', 'team-null'])
  })

  it('never touches local teams even when the server authorizes nothing', async () => {
    mocks.select.mockResolvedValue([
      { id: 'team-a', endpoint: 'https://team.example.com' },
    ])

    await removeUnauthorizedTeamShares([], 'https://team.example.com')

    expect(mocks.select.mock.calls[0][0]).toContain("mode = 'cloud'")
    const [, params] = mocks.executeQuery.mock.calls[0]
    expect(params).toEqual(['team-a'])
  })
})
