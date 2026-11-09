// Snippet batches and scripts go through this path, not through the terminal
// container. After hosts started keeping their secrets in the vault, it was
// building the IPC call from `getHostById()` — metadata with no password and no
// key — so a host with a jump host could not run a batch at all.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'

const ok = async () => ({ success: true, message: '', sessionId: 's' })

const mocks = vi.hoisted(() => ({
  getHostById: vi.fn(),
  createSshPassword: vi.fn(),
  createSshKey: vi.fn(),
  createSshAgent: vi.fn(),
  createSshCert: vi.fn(),
  createSshJump: vi.fn(),
  resolve: vi.fn(),
}))

vi.mock('@/service/database/hosts', () => ({ getHostById: mocks.getHostById }))

vi.mock('@/features/terminal/services', () => ({
  sessionService: {
    createSshPassword: mocks.createSshPassword,
    createSshKey: mocks.createSshKey,
    createSshAgent: mocks.createSshAgent,
    createSshCert: mocks.createSshCert,
    createSshJump: mocks.createSshJump,
  },
}))

vi.mock('@/features/terminal/services/session-credentials', () => ({
  resolveSessionCredential: mocks.resolve,
}))

const { createExecutionSession } = await import('./ssh-execution-session')

function host(overrides: Partial<Host> = {}): Host {
  return {
    id: 'h1',
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
  vi.clearAllMocks()
  mocks.createSshPassword.mockImplementation(ok as never)
  mocks.createSshKey.mockImplementation(ok as never)
  mocks.createSshAgent.mockImplementation(ok as never)
  mocks.createSshCert.mockImplementation(ok as never)
  mocks.createSshJump.mockImplementation(ok as never)
  // The vault holds the secret; the host object carries only a reference.
  mocks.resolve.mockResolvedValue({ ok: true, password: 'from-vault' })
})

describe('the exec path resolves credentials', () => {
  it('a vault-backed host runs with the resolved password', async () => {
    await createExecutionSession(
      host({ credentialRef: { kinds: ['password'], provider: 'vault' } }),
    )
    const [options] = mocks.createSshPassword.mock.calls[0] as unknown as [
      { host: Host },
    ]
    expect(options.host.password).toBe('from-vault')
  })

  it('an inline secret is passed through without a vault read', async () => {
    await createExecutionSession(host({ password: 'typed-now' }))
    const [options] = mocks.createSshPassword.mock.calls[0] as unknown as [
      { host: Host },
    ]
    expect(options.host.password).toBe('typed-now')
    // Nothing to resolve: asking the vault here would be a second source of truth.
    expect(mocks.resolve).not.toHaveBeenCalled()
  })

  it('a failed resolution stops the connection instead of sending nothing', async () => {
    mocks.resolve.mockResolvedValue({
      ok: false,
      message:
        'This host stores its credentials in the vault, which is locked.',
    })
    await expect(
      createExecutionSession(
        host({ credentialRef: { kinds: ['password'], provider: 'vault' } }),
      ),
    ).rejects.toThrow(/vault, which is locked/)
    expect(mocks.createSshPassword).not.toHaveBeenCalled()
  })
})

describe('the jump-host exec path resolves both sides', () => {
  it('resolves the target and the bastion independently', async () => {
    mocks.getHostById.mockResolvedValue(
      host({
        id: 'jump-1',
        hostname: 'bastion.example.test',
        credentialRef: { kinds: ['password'], provider: 'vault' },
      }),
    )
    mocks.resolve.mockImplementation(async (h: Host) => ({
      ok: true,
      password: `pw-for-${h.id}`,
    }))

    await createExecutionSession(
      host({
        jumpHostId: 'jump-1',
        credentialRef: { kinds: ['password'], provider: 'vault' },
      }),
    )

    const [arg] = mocks.createSshJump.mock.calls[0] as unknown as [
      { jumpHost: { password?: string }; targetHost: Host },
    ]
    expect(arg.targetHost.password).toBe('pw-for-h1')
    expect(arg.jumpHost.password).toBe('pw-for-jump-1')
  })

  it('does not call the jump IPC when the bastion cannot be resolved', async () => {
    mocks.getHostById.mockResolvedValue(
      host({
        id: 'jump-1',
        hostname: 'b.test',
        credentialRef: { kinds: ['password'], provider: 'vault' },
      }),
    )
    mocks.resolve.mockResolvedValue({ ok: false, message: 'vault is locked' })

    await expect(
      createExecutionSession(host({ jumpHostId: 'jump-1' })),
    ).rejects.toThrow(/locked/)
    expect(mocks.createSshJump).not.toHaveBeenCalled()
  })
})
