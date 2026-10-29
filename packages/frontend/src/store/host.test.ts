import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
}))

vi.mock('@/service/database', () => ({
  executeQuery: vi.fn(),
  selectStrict: mocks.select,
}))

import { useHostStore } from './host'

describe('useHostStore.loadHosts', () => {
  beforeEach(() => {
    mocks.select.mockReset()
    useHostStore.setState({ hosts: [], loading: false, dbAvailable: true })
  })

  it('clears loading immediately when a pending host query is aborted', async () => {
    let resolveQuery: ((rows: never[]) => void) | undefined
    mocks.select.mockReturnValue(
      new Promise(resolve => {
        resolveQuery = resolve
      }),
    )
    const controller = new AbortController()

    const loadPromise = useHostStore.getState().loadHosts(controller.signal)
    expect(useHostStore.getState().loading).toBe(true)

    controller.abort()

    expect(useHostStore.getState().loading).toBe(false)
    resolveQuery?.([])
    await loadPromise
    expect(useHostStore.getState().hosts).toEqual([])
  })

  it('does not let an older aborted query clear a newer load state', async () => {
    let resolveOlder: ((rows: never[]) => void) | undefined
    let resolveNewer: ((rows: never[]) => void) | undefined
    mocks.select
      .mockReturnValueOnce(
        new Promise(resolve => {
          resolveOlder = resolve
        }),
      )
      .mockReturnValueOnce(
        new Promise(resolve => {
          resolveNewer = resolve
        }),
      )
    const olderController = new AbortController()
    const olderLoad = useHostStore.getState().loadHosts(olderController.signal)

    const newerLoad = useHostStore.getState().loadHosts()
    olderController.abort()
    expect(useHostStore.getState().loading).toBe(true)

    resolveNewer?.([])
    await newerLoad
    expect(useHostStore.getState().loading).toBe(false)

    resolveOlder?.([])
    await olderLoad
    expect(useHostStore.getState().loading).toBe(false)
  })
})
