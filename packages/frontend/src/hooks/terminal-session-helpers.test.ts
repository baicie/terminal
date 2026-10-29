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
      agentForwarding: true,
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
      targetCertificate: null,
      agentForwarding: true,
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
      agentForwarding: true,
    })

    await startTerminalShell('remote', target, undefined, 120, 40)

    expect(invoke).toHaveBeenCalledWith('session_create_ssh_cert', {
      host: 'target.example',
      port: 22,
      username: 'target-user',
      certificate: 'ssh-certificate',
      privateKey: 'private-key',
      password: 'target-password',
      agentForwarding: true,
      cols: 120,
      rows: 40,
    })
  })

  it.each([
    ['password', 'session_create_ssh_password'],
    ['key', 'session_create_ssh_key'],
    ['agent', 'session_create_ssh_agent'],
    ['cert', 'session_create_ssh_cert'],
  ] as const)(
    'pins the preflight host key for %s authentication',
    async (authType, command) => {
      vi.mocked(invoke).mockResolvedValue('ssh-session')

      await startTerminalShell(
        'remote',
        host({
          authType,
          privateKey: 'private-key',
          certificate: 'certificate',
        }),
        undefined,
        120,
        40,
        undefined,
        'ssh-ed25519 AAAApinned',
      )

      expect(invoke).toHaveBeenCalledWith(
        command,
        expect.objectContaining({ expectedHostKey: 'ssh-ed25519 AAAApinned' }),
      )
    },
  )

  it('keeps agent forwarding disabled unless the host opts in', async () => {
    vi.mocked(invoke).mockResolvedValue('ssh-session')

    await startTerminalShell('remote', host(), undefined, 120, 40)

    expect(invoke).toHaveBeenCalledWith(
      'session_create_ssh_password',
      expect.objectContaining({ agentForwarding: false }),
    )
  })

  it('passes saved startup and environment profile to the session command', async () => {
    vi.mocked(invoke).mockResolvedValue('ssh-session')

    await startTerminalShell(
      'remote',
      host({
        startupCommand: 'cd ~/project',
        environment: { APP_ENV: 'development' },
      }),
      undefined,
      120,
      40,
    )

    expect(invoke).toHaveBeenCalledWith(
      'session_create_ssh_password',
      expect.objectContaining({
        profile: {
          startupCommand: 'cd ~/project',
          environment: { APP_ENV: 'development' },
        },
      }),
    )
  })

  it('routes target certificate authentication through a jump host', async () => {
    vi.mocked(invoke).mockResolvedValue('ssh-session')
    const target = host({
      authType: 'cert',
      jumpHostId: 'jump-id',
      certificate: 'target-certificate',
      privateKey: 'target-private-key',
    })
    const jump = host({ id: 'jump-id', name: 'Bastion' })

    await startTerminalShell('remote', target, undefined, 120, 40, jump)

    expect(invoke).toHaveBeenCalledWith(
      'session_create_ssh_jump',
      expect.objectContaining({
        targetCertificate: 'target-certificate',
        targetPrivateKey: 'target-private-key',
        jumpHost: expect.objectContaining({ targetAuthType: 'cert' }),
      }),
    )
  })

  it('routes jump host certificate credentials separately from the target', async () => {
    vi.mocked(invoke).mockResolvedValue('ssh-session')
    const target = host({
      jumpHostId: 'jump-id',
      jumpHostAuthType: 'cert',
    })
    const jump = host({
      id: 'jump-id',
      name: 'Bastion',
      authType: 'cert',
      password: 'jump-key-passphrase',
      privateKey: 'jump-private-key',
      certificate: 'jump-certificate',
    })

    await startTerminalShell('remote', target, undefined, 120, 40, jump)

    expect(invoke).toHaveBeenCalledWith(
      'session_create_ssh_jump',
      expect.objectContaining({
        targetCertificate: null,
        jumpHost: expect.objectContaining({
          authType: 'cert',
          password: 'jump-key-passphrase',
          privateKey: 'jump-private-key',
          certificate: 'jump-certificate',
        }),
      }),
    )
  })

  it('pins the jump and target handshakes independently', async () => {
    vi.mocked(invoke).mockResolvedValue('ssh-session')
    const target = host({ jumpHostId: 'jump-id' })
    const jump = host({ id: 'jump-id', name: 'Bastion' })

    await startTerminalShell(
      'remote',
      target,
      undefined,
      120,
      40,
      jump,
      'ssh-ed25519 AAAAtarget',
      'ssh-ed25519 AAAAjump',
    )

    expect(invoke).toHaveBeenCalledWith(
      'session_create_ssh_jump',
      expect.objectContaining({
        expectedHostKey: 'ssh-ed25519 AAAAtarget',
        jumpHost: expect.objectContaining({
          expectedHostKey: 'ssh-ed25519 AAAAjump',
        }),
      }),
    )
  })
})
