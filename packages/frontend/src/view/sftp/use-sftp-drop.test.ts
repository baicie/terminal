// F0 / TN-02 — the SFTP drop listener must not leak or double-upload.
//
// `use-sftp-drop.ts` subscribes to four `tauri://drag-*` events on the current
// webview window. The subscription is asynchronous (`import(...)` then
// `win.listen()` returns a promise), so a naive cleanup that runs before the
// promise resolves leaks every listener it was about to install.
//
// The implementation on `main` already guards this with a `cancelled` flag and an
// `offs` array, but it had **no test at all** — the guard was there and nothing
// proved it worked. These tests are that proof.
//
// The failure this pins, concretely:
//   • mount → unmount before `import()` resolves  → listener installed anyway
//   • remount during StrictMode's double effect    → two listeners, two uploads
//   • 100 open/close cycles                        → 100 leaked listeners

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const uploadPaths = vi.hoisted(() => vi.fn(async () => undefined))

vi.mock('@/service/sftp-transfer', () => ({ uploadPaths }))

/**
 * A controllable stand-in for `@tauri-apps/api/webviewWindow`.
 *
 * `pendingResolvers` lets a test hold the `import().then(...)` chain open, which is
 * exactly the window where the leak used to happen.
 */
const tauri = vi.hoisted(() => {
  const listeners: Array<{ event: string; off: () => void; active: boolean }> = []
  let holdImport: (() => void) | null = null
  let importShouldWait = false

  const reset = () => {
    listeners.length = 0
    importShouldWait = false
    holdImport = null
  }
  const releaseImport = () => {
    importShouldWait = false
    holdImport?.()
    holdImport = null
  }
  const setImportWait = () => {
    importShouldWait = true
  }
  const getCurrentWebviewWindow = () => ({
    async listen(event: string, handler: (evt: { payload?: unknown }) => void) {
      const record = {
        event,
        handler,
        active: true,
        off: () => {
          record.active = false
        },
      }
      listeners.push(record)
      // The real `listen` resolves with an unlisten function.
      return () => {
        record.active = false
      }
    },
  })
  const activeCount = () => listeners.filter(listener => listener.active).length
  const emit = (event: string, payload?: unknown) => {
    for (const listener of listeners) {
      if (listener.active && listener.event === event) {
        ;(listener as unknown as { handler: (e: { payload?: unknown }) => void }).handler({
          payload,
        })
      }
    }
  }

  return {
    reset,
    releaseImport,
    setImportWait,
    getCurrentWebviewWindow,
    activeCount,
    emit,
    listeners,
    shouldWait: () => importShouldWait,
    takeHold: (fn: () => void) => {
      holdImport = fn
    },
  }
})

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => {
    if (tauri.shouldWait()) {
      // Hold the whole chain open until the test releases it.
      return {
        listen: (...args: Parameters<ReturnType<typeof tauri.getCurrentWebviewWindow>['listen']>) =>
          new Promise(resolve => {
            tauri.takeHold(() => {
              void tauri.getCurrentWebviewWindow().listen(...args).then(resolve)
            })
          }),
      }
    }
    return tauri.getCurrentWebviewWindow()
  },
}))

const { useSftpDrop } = await import('./use-sftp-drop')

function mount(sessionId: string | null = 'sftp-1', remoteDir = '/srv') {
  return renderHook(() => useSftpDrop({ sessionId, remoteDir }))
}

describe('useSftpDrop listener lifecycle', () => {
  beforeEach(() => {
    tauri.reset()
    uploadPaths.mockClear()
    vi.stubGlobal('__TAURI_INTERNALS__', {})
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('installs exactly four listeners for one mount', async () => {
    const hook = mount()
    await waitFor(() => expect(tauri.activeCount()).toBe(4))
    hook.unmount()
    await waitFor(() => expect(tauri.activeCount()).toBe(0))
  })

  it('does not install anything when there is no session', async () => {
    const hook = mount(null)
    // Give the async import a chance to run.
    await act(async () => {
      await Promise.resolve()
    })
    expect(tauri.activeCount()).toBe(0)
    hook.unmount()
  })

  it('unsubscribes everything on unmount', async () => {
    const hook = mount()
    await waitFor(() => expect(tauri.activeCount()).toBe(4))
    hook.unmount()
    expect(tauri.activeCount()).toBe(0)
  })

  it('a drop uploads once and only for the live session', async () => {
    const hook = mount('sftp-1', '/srv')
    await waitFor(() => expect(tauri.activeCount()).toBe(4))

    act(() => {
      tauri.emit('tauri://drag-drop', { paths: ['/local/a.txt'] })
    })

    expect(uploadPaths).toHaveBeenCalledTimes(1)
    expect(uploadPaths).toHaveBeenCalledWith({
      sessionId: 'sftp-1',
      remoteDir: '/srv',
      localPaths: ['/local/a.txt'],
    })
    hook.unmount()
  })

  it('ignores a drop with no paths', async () => {
    const hook = mount()
    await waitFor(() => expect(tauri.activeCount()).toBe(4))
    act(() => {
      tauri.emit('tauri://drag-drop', { paths: [] })
    })
    expect(uploadPaths).not.toHaveBeenCalled()
    hook.unmount()
  })

  it('re-subscribes for a new session without leaving the old ones behind', async () => {
    const hook = mount('sftp-1')
    await waitFor(() => expect(tauri.activeCount()).toBe(4))
    hook.rerender()
    act(() => {
      hook.rerender()
    })
    hook.unmount()

    const fresh = mount('sftp-2')
    await waitFor(() => expect(tauri.activeCount()).toBe(4))
    fresh.unmount()
    expect(tauri.activeCount()).toBe(0)
  })

  it('does not leak across 100 mount/unmount cycles', async () => {
    // The task book asks for 100 open/close cycles; the pre-existing suite only
    // ever did five.
    for (let index = 0; index < 100; index += 1) {
      const hook = mount(`sftp-${index}`)
      // No await: some cycles tear down before the import resolves, which is the
      // path that used to leak.
      hook.unmount()
    }
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(tauri.activeCount()).toBe(0)
  })

  it('does not install listeners when torn down before import resolves', async () => {
    tauri.setImportWait()
    const hook = mount()
    hook.unmount()
    // Now let the deferred import finish; the cancelled flag must stop it.
    act(() => {
      tauri.releaseImport()
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(tauri.activeCount()).toBe(0)
  })
})
