import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./connection', () => ({
  executeQuery: vi.fn(),
  select: vi.fn(),
}))

import { executeQuery } from './connection'
import { setActiveWorkspace } from './workspaces'

describe('setActiveWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('activates exactly one existing workspace with one atomic statement', async () => {
    vi.mocked(executeQuery).mockResolvedValue({ rowsAffected: 2 } as never)

    await setActiveWorkspace('workspace-two')

    expect(executeQuery).toHaveBeenCalledOnce()
    expect(executeQuery).toHaveBeenCalledWith(
      expect.stringContaining('CASE WHEN id = ? THEN 1 ELSE 0 END'),
      ['workspace-two', 'workspace-two'],
    )
  })

  it('rejects an unknown target without clearing the active workspace', async () => {
    vi.mocked(executeQuery).mockResolvedValue({ rowsAffected: 0 } as never)

    await expect(setActiveWorkspace('missing')).rejects.toThrow(
      'Workspace not found: missing',
    )
  })
})
