import { beforeEach, expect, it, vi } from 'vitest'
import type { AuthType, Host } from '@/types'
import { sshService } from './ssh'

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  createAgent: vi.fn(),
  createCert: vi.fn(),
  createJump: vi.fn(),
  createKey: vi.fn(),
  createPassword: vi.fn(),
  getHostById: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('@/features/terminal/services', () => ({
  sessionService: {
    close: mocks.close,
    createSshAgent: mocks.createAgent,
    createSshCert: mocks.createCert,
    createSshJump: mocks.createJump,
    createSshKey: mocks.createKey,
    createSshPassword: mocks.createPassword,
  },
  sftpService: {},
  portForwardService: {},
}))
vi.mock('@/service/database/hosts', () => ({
  getHostById: mocks.getHostById,
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))

function host(authType: AuthType, overrides: Partial<Host> = {}): Host {
  return {
    id: 'target-id',
    name: 'Target',
    hostname: 'target.example',
    port: 22,
    username: 'target-user',
    authType,
    password: 'password',
    privateKey: 'private-key',
    certificate: 'certificate',
    isFavorite: false,
    portForwards: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  const connected = { success: true, message: 'connected', sessionId: 'sid' }
  for (const create of [
    mocks.createPassword,
    mocks.createKey,
    mocks.createAgent,
    mocks.createCert,
    mocks.createJump,
  ])
    create.mockResolvedValue(connected)
  mocks.close.mockResolvedValue(undefined)
  mocks.invoke.mockResolvedValue({ stdout: 'ok', stderr: '', exit_code: 0 })
})

it.each([
  ['password', mocks.createPassword],
  ['key', mocks.createKey],
  ['agent', mocks.createAgent],
  ['cert', mocks.createCert],
] as const)('uses %s authentication for script execution', async (authType, create) => {
  await sshService.execute(host(authType), 'whoami')

  expect(create).toHaveBeenCalledWith({
    host: expect.objectContaining({ authType }),
    cols: 80,
    rows: 24,
  })
})

it('resolves and uses the configured jump host for script execution', async () => {
  const jump = host('password', {
    id: 'jump-id',
    name: 'Bastion',
    hostname: 'jump.example',
    username: 'jump-user',
  })
  mocks.getHostById.mockResolvedValue(jump)
  const target = host('key', {
    jumpHostId: 'jump-id',
    jumpHostAuthType: 'agent',
  })

  await sshService.execute(target, 'whoami')

  expect(mocks.createJump).toHaveBeenCalledWith({
    targetHost: target,
    jumpHost: {
      host: 'jump.example',
      port: 22,
      username: 'jump-user',
      authType: 'agent',
      password: 'password',
      privateKey: 'private-key',
      certificate: 'certificate',
      targetAuthType: 'key',
    },
    cols: 80,
    rows: 24,
  })
})

it('routes certificate authentication on both sides for script execution', async () => {
  const jump = host('cert', {
    id: 'jump-id',
    name: 'Certificate bastion',
    hostname: 'jump.example',
    username: 'jump-user',
    password: 'jump-key-passphrase',
    privateKey: 'jump-private-key',
    certificate: 'jump-certificate',
  })
  mocks.getHostById.mockResolvedValue(jump)
  const target = host('cert', {
    jumpHostId: 'jump-id',
    jumpHostAuthType: 'cert',
    password: 'target-key-passphrase',
    privateKey: 'target-private-key',
    certificate: 'target-certificate',
  })

  await sshService.execute(target, 'whoami')

  expect(mocks.createJump).toHaveBeenCalledWith({
    targetHost: target,
    jumpHost: {
      host: 'jump.example',
      port: 22,
      username: 'jump-user',
      authType: 'cert',
      password: 'jump-key-passphrase',
      privateKey: 'jump-private-key',
      certificate: 'jump-certificate',
      targetAuthType: 'cert',
    },
    cols: 80,
    rows: 24,
  })
})

it('accepts certificate credentials through the legacy jump session wrapper', async () => {
  const target = host('cert')

  await sshService.createSshSessionJump(target, {
    host: 'jump.example',
    port: 22,
    username: 'jump-user',
    authType: 'cert',
    password: 'jump-key-passphrase',
    privateKey: 'jump-private-key',
    certificate: 'jump-certificate',
    targetAuthType: 'cert',
  })

  expect(mocks.createJump).toHaveBeenCalledWith({
    targetHost: target,
    jumpHost: expect.objectContaining({
      authType: 'cert',
      certificate: 'jump-certificate',
      targetAuthType: 'cert',
    }),
    cols: 80,
    rows: 24,
  })
})
