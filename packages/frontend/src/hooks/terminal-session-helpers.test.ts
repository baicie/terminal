import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import { startTerminalShell } from './terminal-session-helpers'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: 'host-id',
    name: 'Target',
    hostname: 'target.example',
    port: 22,
    username: 'target-user',
    authType: 'password',
    password: 'target-password',
    isFavorite: false,
    portForwards: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('startTerminalShell jump host routing', () => {
  beforeEach(() => vi.mocked(invoke).mockReset())

  it('routes a configured target through the resolved jump host', async () => {
    vi.mocked(invoke).mockResolvedValue('ssh-session')
    const target = host({
      jumpHostId: 'jump-id',
      jumpHostAuthType: 'agent',
    })
    const jump = host({
      id: 'jump-id',
      name: 'Bastion',
      hostname: 'jump.example',
      username: 'jump-user',
      authType: 'password',
      password: 'jump-password',
    })

    await startTerminalShell('remote', target, undefined, 120, 40, jump)

    expect(invoke).toHaveBeenCalledWith('session_create_ssh_jump', {
      targetHost: 'target.example',
      targetPort: 22,
      targetUsername: 'target-user',
      targetPassword: 'target-password',
      targetPrivateKey: null,
      jumpHost: {
        host: 'jump.example',
        port: 22,
        username: 'jump-user',
        authType: 'agent',
        password: 'jump-password',
        privateKey: null,
        certificate: null,
        targetAuthType: 'password',
      },
      cols: 120,
      rows: 40,
    })
  })

  it('uses Tauri camelCase arguments for certificate authentication', async () => {
    vi.mocked(invoke).mockResolvedValue('ssh-session')
    const target = host({
      authType: 'cert',
      certificate: 'ssh-certificate',
      privateKey: 'private-key',
    })

    await startTerminalShell('remote', target, undefined, 120, 40)

    expect(invoke).toHaveBeenCalledWith('session_create_ssh_cert', {
      host: 'target.example',
      port: 22,
      username: 'target-user',
      certificate: 'ssh-certificate',
      privateKey: 'private-key',
      password: 'target-password',
      cols: 120,
      rows: 40,
    })
  })

  it('rejects certificate authentication through a jump host without invoking IPC', async () => {
    const target = host({ authType: 'cert', jumpHostId: 'jump-id' })
    const jump = host({ id: 'jump-id', name: 'Bastion' })

    await expect(
      startTerminalShell('remote', target, undefined, 120, 40, jump),
    ).rejects.toThrow(
      'Certificate authentication through a jump host is not supported yet',
    )
    expect(invoke).not.toHaveBeenCalled()
  })
})
