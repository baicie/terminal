// The main terminal's connect path must resolve credentials the same way the
// session service does. Before this, it read `host.password` directly, so a host
// whose secret lives in the vault connected with an empty password.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  resolverResolve: vi.fn(),
  providerAvailable: vi.fn(async () => true),
}))

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }))
vi.mock('@/service/vault-secret-provider', () => ({
  vaultSecretProvider: {
    isAvailable: mocks.providerAvailable,
    read: vi.fn(),
    write: vi.fn(),
    remove: vi.fn(),
  },
}))
vi.mock('@/service/credential-boundary', async importOriginal => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    SessionCredentialResolver: class {
      resolve = mocks.resolverResolve
    },
  }
})
vi.mock('./startup-trace', () => ({
  traceStageAndWait: vi.fn(async () => undefined),
}))

const { startTerminalShell: createTerminalSession } = await import('./terminal-launcher')

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: 'host-1',
    name: 'prod',
    hostname: 'prod.example.test',
    port: 22,
    username: 'alice',
    authType: 'password',
    isFavorite: false,
    portForwards: [],
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Host
}

beforeEach(() => {
  mocks.invoke.mockReset()
  mocks.resolverResolve.mockReset()
  mocks.providerAvailable.mockResolvedValue(true)
  mocks.invoke.mockResolvedValue('session-1')
})

describe('password hosts', () => {
  it('uses a secret typed into the form without consulting the vault', async () => {
    await createTerminalSession('remote', host({ password: 'typed' }), undefined, 80, 24)

    const [command, args] = mocks.invoke.mock.calls[0] as [string, Record<string, unknown>]
    expect(command).toBe('session_create_ssh_password')
    expect(args.password).toBe('typed')
    expect(mocks.resolverResolve).not.toHaveBeenCalled()
  })

  it('resolves the stored secret when the host carries only a reference', async () => {
    mocks.resolverResolve.mockResolvedValue({
      ok: true,
      credential: { password: 'from-vault' },
    })
    await createTerminalSession(
      'remote',
      host({ credentialRef: { kinds: ['password'], provider: 'vault' } }),
      undefined,
      80,
      24,
    )

    const [, args] = mocks.invoke.mock.calls[0] as [string, Record<string, unknown>]
    expect(args.password).toBe('from-vault')
  })

  it('fails with the vault reason instead of connecting with an empty password', async () => {
    mocks.resolverResolve.mockResolvedValue({
      ok: false,
      reason: 'vault-unavailable',
      message: 'This host stores its credentials in the vault, which is locked.',
    })

    await expect(
      createTerminalSession(
        'remote',
        host({ credentialRef: { kinds: ['password'], provider: 'vault' } }),
        undefined,
        80,
        24,
      ),
    ).rejects.toThrow(/credentials in the vault, which is locked/i)

    // No SSH command was issued with a blank password.
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})

describe('key and certificate hosts', () => {
  it('resolves a stored private key', async () => {
    mocks.resolverResolve.mockResolvedValue({
      ok: true,
      credential: { privateKey: 'KEY-MATERIAL', password: 'PASSPHRASE' },
    })
    await createTerminalSession(
      'remote',
      host({ authType: 'key', credentialRef: { kinds: ['privateKey', 'passphrase'], provider: 'vault' } }),
      undefined,
      80,
      24,
    )

    const [, args] = mocks.invoke.mock.calls[0] as [string, Record<string, unknown>]
    expect(args.privateKey).toBe('KEY-MATERIAL')
  })

  it('lets an agent host connect without any stored credential', async () => {
    await createTerminalSession('remote', host({ authType: 'agent' }), undefined, 80, 24)

    const [command] = mocks.invoke.mock.calls[0] as [string, unknown]
    expect(command).toBe('session_create_ssh_agent')
    expect(mocks.resolverResolve).not.toHaveBeenCalled()
  })
})

describe('jump hosts resolve both sides', () => {
  it('resolves the target and the jump host independently', async () => {
    mocks.resolverResolve
      .mockResolvedValueOnce({ ok: true, credential: { password: 'target-pass' } })
      .mockResolvedValueOnce({ ok: true, credential: { password: 'jump-pass' } })

    const jump = host({
      id: 'jump-1',
      name: 'bastion',
      hostname: 'bastion.example.test',
      credentialRef: { kinds: ['password'], provider: 'vault' },
    })
    await createTerminalSession(
      'remote',
      host({
        jumpHostId: 'jump-1',
        credentialRef: { kinds: ['password'], provider: 'vault' },
      }),
      undefined,
      80,
      24,
      jump,
    )

    const [command, args] = mocks.invoke.mock.calls[0] as [
      string,
      { targetPassword: string, jumpHost: { password: string } },
    ]
    expect(command).toBe('session_create_ssh_jump')
    expect(args.targetPassword).toBe('target-pass')
    expect(args.jumpHost.password).toBe('jump-pass')
  })

  it('does not connect when only the jump host secret is missing', async () => {
    mocks.resolverResolve
      .mockResolvedValueOnce({ ok: true, credential: { password: 'target-pass' } })
      .mockResolvedValueOnce({
        ok: false,
        reason: 'vault-unavailable',
        message: 'This host stores its credentials in the vault, which is locked.',
      })

    const jump = host({
      id: 'jump-1',
      hostname: 'bastion.example.test',
      credentialRef: { kinds: ['password'], provider: 'vault' },
    })
    await expect(
      createTerminalSession(
        'remote',
        host({
          jumpHostId: 'jump-1',
          credentialRef: { kinds: ['password'], provider: 'vault' },
        }),
        undefined,
        80,
        24,
        jump,
      ),
    ).rejects.toThrow(/credentials in the vault, which is locked/i)
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
})
