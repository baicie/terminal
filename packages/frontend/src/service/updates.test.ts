import { describe, expect, it, vi } from 'vitest'
import {
  checkForUpdates,
  classifyUpdateFailure,
  type UpdateDependencies,
} from './updates'

function dependencies(
  overrides: Partial<UpdateDependencies> = {},
): UpdateDependencies {
  return {
    isDesktop: () => true,
    loadBridge: async () => ({
      currentVersion: async () => '0.0.1-dev.2',
      check: async () => null,
    }),
    ...overrides,
  }
}

describe('checkForUpdates', () => {
  it('reports unsupported outside the desktop runtime', async () => {
    const loadBridge = vi.fn()
    const status = await checkForUpdates(
      dependencies({ isDesktop: () => false, loadBridge }),
    )
    expect(status).toEqual({ status: 'unsupported' })
    expect(loadBridge).not.toHaveBeenCalled()
  })

  it('is up to date when the updater returns no update', async () => {
    const status = await checkForUpdates(dependencies())
    expect(status).toEqual({ status: 'up-to-date', version: '0.0.1-dev.2' })
  })

  it('reports an available version without installing it', async () => {
    const downloadAndInstall = vi.fn()
    const status = await checkForUpdates(
      dependencies({
        loadBridge: async () => ({
          currentVersion: async () => '0.0.1-dev.2',
          check: async () => ({
            version: '0.0.3',
            body: 'notes',
            downloadAndInstall,
          }),
        }),
      }),
    )
    expect(status).toEqual({
      status: 'available',
      version: '0.0.3',
      notes: 'notes',
    })
    expect(downloadAndInstall).not.toHaveBeenCalled()
  })

  it('treats a placeholder public key as an unconfigured updater', async () => {
    const status = await checkForUpdates(
      dependencies({
        loadBridge: async () => ({
          currentVersion: async () => '0.0.1-dev.2',
          check: async () => {
            throw new Error('invalid updater public key')
          },
        }),
      }),
    )
    expect(status.status).toBe('unconfigured')
  })

  it('surfaces a genuine failure as an error', async () => {
    const status = await checkForUpdates(
      dependencies({
        loadBridge: async () => {
          throw new Error('plugin not registered')
        },
      }),
    )
    expect(status.status).toBe('error')
    expect(classifyUpdateFailure(new Error('something else')).status).toBe(
      'error',
    )
    expect(
      classifyUpdateFailure(new Error('invalid updater public key')).status,
    ).toBe('unconfigured')
  })
})
