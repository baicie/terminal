import { beforeEach, expect, it, vi } from 'vitest'
import { exportTeamPackage } from './sync-team'

const mocks = vi.hoisted(() => ({
  executeQuery: vi.fn(),
  getUserProfile: vi.fn(),
  getKnownHosts: vi.fn(),
  getSSHKeys: vi.fn(),
  getWorkspaceLayout: vi.fn(),
  getWorkspaces: vi.fn(),
  save: vi.fn(),
  selectStrict: vi.fn(),
  writeTextFile: vi.fn(),
}))

vi.mock('@/service/database', () => ({
  executeQuery: mocks.executeQuery,
  getUserProfile: mocks.getUserProfile,
  selectStrict: mocks.selectStrict,
}))
vi.mock('@/service/database/known-hosts', () => ({
  getKnownHosts: mocks.getKnownHosts,
}))
vi.mock('@/service/database/ssh-keys', () => ({ getSSHKeys: mocks.getSSHKeys }))
vi.mock('@/service/database/workspaces', () => ({
  getWorkspaceLayout: mocks.getWorkspaceLayout,
  getWorkspaces: mocks.getWorkspaces,
}))
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: mocks.save }))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeTextFile: mocks.writeTextFile }))

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.getUserProfile.mockResolvedValue({ id: 'user-1' })
  mocks.getKnownHosts.mockResolvedValue([])
  mocks.getSSHKeys.mockResolvedValue([])
  mocks.getWorkspaces.mockResolvedValue([])
  mocks.selectStrict.mockResolvedValue([])
  mocks.save.mockResolvedValue('/tmp/team-package.json')
})

it('aborts the team package when a package source cannot be read', async () => {
  mocks.selectStrict.mockRejectedValue(
    new Error('Database query failed: disk I/O error'),
  )

  await expect(
    exportTeamPackage({
      teamId: 'team-1',
      teamName: 'Team',
      includeHosts: true,
      includeSSHKeys: true,
    }),
  ).rejects.toThrow('disk I/O error')
  expect(mocks.save).not.toHaveBeenCalled()
  expect(mocks.writeTextFile).not.toHaveBeenCalled()
})

it('still writes an empty package when the database is genuinely empty', async () => {
  const path = await exportTeamPackage({
    teamId: 'team-1',
    teamName: 'Team',
    includeHosts: true,
    includeSSHKeys: true,
  })

  expect(path).toBe('/tmp/team-package.json')
  expect(mocks.writeTextFile).toHaveBeenCalledTimes(1)
  const written = JSON.parse(
    mocks.writeTextFile.mock.calls[0][1] as string,
  ) as Record<string, unknown>
  expect(written.version).toBe('1.0')
  expect(written.hosts).toEqual([])
  expect(written.sshKeys).toEqual([])
  expect(written.exportedBy).toBe('user-1')
})
