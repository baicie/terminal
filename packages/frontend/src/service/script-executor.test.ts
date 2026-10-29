import { beforeEach, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import type { SSHService } from './ssh'
import { executeOnHosts } from './script-executor'

const mocks = vi.hoisted(() => ({
  addExecution: vi.fn(),
  getHosts: vi.fn(),
  updateExecution: vi.fn(),
}))

vi.mock('@/service/database', () => ({
  addScriptExecution: mocks.addExecution,
  getHosts: mocks.getHosts,
  updateScriptExecution: mocks.updateExecution,
}))

const hosts: Host[] = ['host-1', 'host-2', 'host-3'].map(id => ({
  id,
  name: id,
  hostname: `${id}.example`,
  port: 22,
  username: 'user',
  authType: 'password',
  password: 'secret',
  isFavorite: false,
  portForwards: [],
  createdAt: 1,
  updatedAt: 1,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getHosts.mockResolvedValue(hosts)
  mocks.addExecution.mockImplementation(({ host_id }: { host_id: string }) =>
    Promise.resolve(host_id ?? 'aggregate'),
  )
  mocks.updateExecution.mockResolvedValue(undefined)
})

it('passes the configured timeout to each SSH execution in milliseconds', async () => {
  const execute = vi
    .fn()
    .mockResolvedValue({ stdout: 'ok', stderr: '', exitCode: 0 })

  await executeOnHosts(
    { execute } as unknown as SSHService,
    'whoami',
    ['host-1'],
    7,
  )

  expect(execute).toHaveBeenCalledWith(hosts[0], 'whoami', 7000)
})

it('retries a failed host up to the configured count', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ stdout: '', stderr: 'failed', exitCode: 1 })
    .mockResolvedValueOnce({ stdout: 'ok', stderr: '', exitCode: 0 })

  const result = await executeOnHosts(
    { execute } as unknown as SSHService,
    'whoami',
    ['host-1'],
    7,
    2,
  )

  expect(execute).toHaveBeenCalledTimes(2)
  expect(result.success).toBe(true)
})

it.each([
  [[0, 1], 'success'],
  [[0, 1, 1], 'success'],
  [[1, 1], 'failed'],
] as const)('records aggregate status for exit codes %j', async (exitCodes, status) => {
  const execute = vi.fn()
  for (const exitCode of exitCodes) {
    execute.mockResolvedValueOnce({ stdout: '', stderr: '', exitCode })
  }

  await executeOnHosts(
    { execute } as unknown as SSHService,
    'whoami',
    hosts.slice(0, exitCodes.length).map(host => host.id),
  )

  expect(mocks.updateExecution).toHaveBeenCalledWith(
    'aggregate',
    expect.objectContaining({ status }),
  )
})
