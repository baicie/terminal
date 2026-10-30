import { beforeEach, expect, it, vi } from 'vitest'
import { storageDownload } from './storage'

const tauri = vi.hoisted(() => ({
  mode: 'ok' as 'ok' | 'empty' | 'failing',
  message: '',
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: () => {
    if (tauri.mode === 'ok') return Promise.resolve('{"hosts":[]}')
    if (tauri.mode === 'empty') return Promise.resolve('')
    // The backend reports a failed read as a StorageError DTO with a message.
    throw Object.assign(new Error(tauri.message), { type: 'download_failed' })
  },
}))

beforeEach(() => {
  tauri.mode = 'ok'
  tauri.message = ''
})

it('returns the backup content when the download succeeds', async () => {
  expect(await storageDownload('terminal-latest.json')).toEqual({
    status: 'ok',
    data: '{"hosts":[]}',
  })
})

it('reports a genuinely missing backup as notFound', async () => {
  tauri.mode = 'empty'
  expect(await storageDownload('terminal-latest.json')).toEqual({
    status: 'notFound',
  })

  tauri.mode = 'failing'
  tauri.message = 'WebDAV download failed with status: 404 Not Found'
  expect(await storageDownload('terminal-latest.json')).toEqual({
    status: 'notFound',
  })
})

it('reports a failed read as error instead of "no backup on the server"', async () => {
  tauri.mode = 'failing'
  tauri.message = 'WebDAV download failed: connection refused'

  expect(await storageDownload('terminal-latest.json')).toEqual({
    status: 'error',
    error: 'download_failed: WebDAV download failed: connection refused',
  })
})
