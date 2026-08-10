import { expect, it, vi } from 'vitest'
import type { ScriptRecord } from '@/service/database'
import { ScriptService } from './scripts'

const mocks = vi.hoisted(() => ({
  executeOnHosts: vi.fn(),
  getScriptById: vi.fn(),
  toggleScriptEnabled: vi.fn(),
}))

vi.mock('@/service/database', () => ({
  clearScriptExecutions: vi.fn(),
  createScript: vi.fn(),
  deleteScript: vi.fn(),
  deleteScriptExecution: vi.fn(),
  getEnabledScripts: vi.fn(),
  getScriptById: mocks.getScriptById,
  getScriptExecutionById: vi.fn(),
  getScriptExecutions: vi.fn(),
  getScripts: vi.fn(),
  searchScripts: vi.fn(),
  toggleScriptEnabled: mocks.toggleScriptEnabled,
  updateScript: vi.fn(),
}))
vi.mock('./script-executor', () => ({
  executeOnHosts: mocks.executeOnHosts,
}))
vi.mock('./script-scheduler', () => ({
  ScriptScheduler: class {
    start() {}
    stop() {}
  },
}))
vi.mock('@/service/ssh', () => ({ SSHService: class {} }))

it('uses the saved retry count and disables a once schedule before execution', async () => {
  const script: ScriptRecord = {
    id: 'script-1',
    name: 'Once',
    description: null,
    script: 'whoami',
    host_ids: '["host-1"]',
    schedule_type: 'once',
    schedule_value: '0',
    enabled: 1,
    timeout_seconds: 7,
    retry_count: 2,
    created_at: 1,
    updated_at: 1,
  }
  mocks.getScriptById.mockResolvedValue(script)
  mocks.executeOnHosts.mockResolvedValue({ success: true })

  await new ScriptService().executeScript(script.id)

  expect(mocks.toggleScriptEnabled).toHaveBeenCalledWith(script.id)
  expect(mocks.executeOnHosts).toHaveBeenCalledWith(
    expect.anything(),
    'whoami',
    ['host-1'],
    7,
    2,
  )
})
