import { describe, expect, it, vi } from 'vitest'
import {
  checkForUpdates,
  classifyUpdateFailure,
  isUpdateFailure,
  readCurrentVersion,
  UPDATE_FAILURE_STATUSES,
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

function failingCheck(error: unknown): UpdateDependencies {
  return dependencies({
    loadBridge: async () => ({
      currentVersion: async () => '0.0.1-dev.2',
      check: async () => {
        throw error
      },
    }),
  })
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

  it('reports up to date even when the version cannot be read', async () => {
    const status = await checkForUpdates(
      dependencies({
        loadBridge: async () => ({
          currentVersion: async () => {
            throw new Error('version command not allowed')
          },
          check: async () => null,
        }),
      }),
    )
    expect(status).toEqual({ status: 'up-to-date', version: null })
  })

  it('reports offline before blaming the endpoint', async () => {
    const status = await checkForUpdates({
      ...failingCheck(
        'error sending request for url (https://releases.test/latest.json): error trying to connect: dns error',
      ),
      isOnline: () => false,
    })
    expect(status.status).toBe('offline')
  })

  it('reports a timed out request as a timeout', async () => {
    const status = await checkForUpdates(
      failingCheck('error sending request: operation timed out'),
    )
    expect(status.status).toBe('timeout')
  })

  it('reports an endpoint without a release manifest as unreachable', async () => {
    const status = await checkForUpdates(
      failingCheck('Could not fetch a valid release JSON from the remote'),
    )
    expect(status.status).toBe('unreachable')
  })

  it('keeps a rejected signature out of the configuration copy', async () => {
    const status = await checkForUpdates(
      failingCheck('signature mismatch for the release manifest'),
    )
    expect(status).toEqual({
      status: 'signature',
      detail: 'signature mismatch for the release manifest',
    })
  })
})

describe('classifyUpdateFailure', () => {
  const connectError =
    'error sending request for url (https://releases.test/latest.json): error trying to connect: dns error'

  it('separates timeout, unreachable and offline with the same message', () => {
    expect(
      classifyUpdateFailure('error sending request: operation timed out', {
        isOnline: true,
      }).status,
    ).toBe('timeout')
    expect(
      classifyUpdateFailure(connectError, { isOnline: true }).status,
    ).toBe('unreachable')
    expect(
      classifyUpdateFailure(connectError, { isOnline: false }).status,
    ).toBe('offline')
  })

  it('treats a missing endpoint as a configuration gap', () => {
    expect(
      classifyUpdateFailure('Updater does not have any endpoints set.').status,
    ).toBe('unconfigured')
  })

  it('keeps a rejected signature away from the configuration gap', () => {
    expect(
      classifyUpdateFailure('invalid signature for the downloaded package')
        .status,
    ).toBe('signature')
  })

  it('unwraps a plain string rejection from the Tauri IPC', () => {
    const status = classifyUpdateFailure('operation timed out', {
      isOnline: true,
    })
    expect(status.status).toBe('timeout')
    expect(isUpdateFailure(status) ? status.detail : null).toBe(
      'operation timed out',
    )
  })

  it('keeps every failure class distinct', () => {
    expect(new Set(UPDATE_FAILURE_STATUSES).size).toBe(
      UPDATE_FAILURE_STATUSES.length,
    )
    expect([...UPDATE_FAILURE_STATUSES]).toEqual([
      'offline',
      'timeout',
      'unreachable',
      'unconfigured',
      'signature',
    ])
  })
})

describe('isUpdateFailure', () => {
  it('separates failure statuses from the rest', () => {
    expect(isUpdateFailure({ status: 'offline', detail: 'no link' })).toBe(true)
    expect(isUpdateFailure({ status: 'up-to-date', version: null })).toBe(false)
    expect(isUpdateFailure({ status: 'unsupported' })).toBe(false)
  })
})

describe('readCurrentVersion', () => {
  it('returns the version the runtime reports', async () => {
    expect(await readCurrentVersion(dependencies())).toBe('0.0.1-dev.2')
  })

  it('returns null instead of inventing a version', async () => {
    expect(
      await readCurrentVersion(dependencies({ isDesktop: () => false })),
    ).toBeNull()
    expect(
      await readCurrentVersion(
        dependencies({
          loadBridge: async () => {
            throw new Error('plugin not registered')
          },
        }),
      ),
    ).toBeNull()
    expect(
      await readCurrentVersion(
        dependencies({
          loadBridge: async () => ({
            currentVersion: async () => {
              throw new Error('version command not allowed')
            },
            check: async () => null,
          }),
        }),
      ),
    ).toBeNull()
  })
})
