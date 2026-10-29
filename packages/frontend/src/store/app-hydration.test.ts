import { beforeEach, describe, expect, it, vi } from 'vitest'

const getAppSettings = vi.fn()

vi.mock('@/service/database', () => ({
  getAppSettings: () => getAppSettings(),
}))

describe('app settings hydration', () => {
  beforeEach(() => {
    getAppSettings.mockReset()
  })

  it('reports a failed hydration instead of silently reverting user settings', async () => {
    // Theme, language and every persisted preference come from this one read.
    // Swallowing the error leaves the app looking healthy while the user's
    // settings silently reset to defaults, with nothing on screen to explain
    // why their theme or language changed.
    getAppSettings.mockRejectedValue(new Error('database is locked'))
    const { useAppStore } = await import('./app')

    await expect(useAppStore.getState().hydrateFromDatabase()).resolves.toBe(
      false,
    )
  })

  it('reports success when settings load normally', async () => {
    getAppSettings.mockResolvedValue({
      theme: 'light',
      language: 'cn',
    })
    const { useAppStore } = await import('./app')

    await expect(useAppStore.getState().hydrateFromDatabase()).resolves.toBe(
      true,
    )
    expect(useAppStore.getState().theme).toBe('light')
    expect(useAppStore.getState().language).toBe('cn')
  })
})
