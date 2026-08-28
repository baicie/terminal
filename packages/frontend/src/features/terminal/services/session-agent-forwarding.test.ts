import { invoke } from '@tauri-apps/api/core'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AuthType, Host } from '@/types'
import { SessionService } from './session'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('./session-connection-logs', () => ({
  finishConnectionLog: vi.fn(),
  recordConnectionFailure: vi.fn(),
  recordConnectionSuccess: vi.fn(),
}))

function host(authType: AuthType): Host {
  return {
    id: 'host-id',
    name: 'Host',
    hostname: 'host.example',
    port: 22,
    username: 'user',
    authType,
    password: 'password',
    privateKey: 'private-key',
    certificate: 'certificate',
    agentForwarding: true,
    isFavorite: false,
    portForwards: [],
    createdAt: 1,
    updatedAt: 1,
  }
}

beforeEach(() => {
  vi.mocked(invoke).mockReset().mockResolvedValue('session-id')
})

it.each([
  ['password', 'session_create_ssh_password', 'createSshPassword'],
  ['key', 'session_create_ssh_key', 'createSshKey'],
  ['agent', 'session_create_ssh_agent', 'createSshAgent'],
  ['cert', 'session_create_ssh_cert', 'createSshCert'],
] as const)(
  'passes agent forwarding through %s session creation',
  async (authType, command, method) => {
    const service = new SessionService()

    await service[method]({ host: host(authType) })

    expect(invoke).toHaveBeenCalledWith(
      command,
      expect.objectContaining({ agentForwarding: true }),
    )
  },
)

it('passes target host agent forwarding through jump session creation', async () => {
  const service = new SessionService()

  await service.createSshJump({
    targetHost: host('password'),
    jumpHost: {
      host: 'jump.example',
      port: 22,
      username: 'jump-user',
      authType: 'password',
      password: 'jump-password',
    },
  })

  expect(invoke).toHaveBeenCalledWith(
    'session_create_ssh_jump',
    expect.objectContaining({ agentForwarding: true }),
  )
})
