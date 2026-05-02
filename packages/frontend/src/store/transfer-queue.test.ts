import { describe, expect, it, beforeEach } from 'vitest'
import { useTransferQueue } from './transfer-queue'

function reset() {
  useTransferQueue.setState({ transfers: [], panelOpen: false })
}

describe('useTransferQueue', () => {
  beforeEach(() => reset())

  it('enqueue() adds a running transfer and opens the panel', () => {
    const id = useTransferQueue.getState().enqueue({
      id: '',
      kind: 'upload',
      name: 'a.txt',
      localPath: '/tmp/a.txt',
      remotePath: '/srv/a.txt',
      sessionId: 's1',
      bytesTotal: 100,
    })

    const state = useTransferQueue.getState()
    expect(state.panelOpen).toBe(true)
    expect(state.transfers).toHaveLength(1)
    expect(state.transfers[0].id).toBe(id)
    expect(state.transfers[0].status).toBe('running')
    expect(state.transfers[0].bytesTotal).toBe(100)
    expect(state.transfers[0].bytesDone).toBe(0)
  })

  it('updateProgress() updates bytesDone and computes a positive speed sample', async () => {
    const id = useTransferQueue.getState().enqueue({
      id: '',
      kind: 'download',
      name: 'b.bin',
      localPath: '/tmp/b.bin',
      remotePath: '/srv/b.bin',
      sessionId: 's1',
      bytesTotal: 1000,
    })

    // First sample sets baseline
    useTransferQueue.getState().updateProgress(id, 100, 1000)
    // Force a tiny wait to make speed > 0
    await new Promise(r => setTimeout(r, 12))
    useTransferQueue.getState().updateProgress(id, 600, 1000)

    const t = useTransferQueue.getState().transfers[0]
    expect(t.bytesDone).toBe(600)
    expect(t.bytesTotal).toBe(1000)
    expect(t.speed).toBeGreaterThan(0)
  })

  it('finish("done") snaps bytesDone to bytesTotal', () => {
    const id = useTransferQueue.getState().enqueue({
      id: '',
      kind: 'upload',
      name: 'c.txt',
      localPath: '/tmp/c.txt',
      remotePath: '/srv/c.txt',
      sessionId: 's1',
      bytesTotal: 500,
    })
    useTransferQueue.getState().updateProgress(id, 200, 500)
    useTransferQueue.getState().finish(id, 'done')

    const t = useTransferQueue.getState().transfers[0]
    expect(t.status).toBe('done')
    expect(t.bytesDone).toBe(500)
    expect(t.finishedAt).toBeGreaterThan(0)
  })

  it('finish("error") records message but keeps bytesDone', () => {
    const id = useTransferQueue.getState().enqueue({
      id: '',
      kind: 'upload',
      name: 'd.txt',
      localPath: '/tmp/d.txt',
      remotePath: '/srv/d.txt',
      sessionId: 's1',
      bytesTotal: 500,
    })
    useTransferQueue.getState().updateProgress(id, 250, 500)
    useTransferQueue.getState().finish(id, 'error', 'permission denied')

    const t = useTransferQueue.getState().transfers[0]
    expect(t.status).toBe('error')
    expect(t.message).toBe('permission denied')
    expect(t.bytesDone).toBe(250)
  })

  it('clearFinished() removes done/error and keeps running', () => {
    const a = useTransferQueue.getState().enqueue({
      id: '',
      kind: 'upload',
      name: 'a',
      localPath: '/a',
      remotePath: '/a',
      sessionId: 's1',
    })
    const b = useTransferQueue.getState().enqueue({
      id: '',
      kind: 'upload',
      name: 'b',
      localPath: '/b',
      remotePath: '/b',
      sessionId: 's1',
    })
    useTransferQueue.getState().finish(a, 'done')
    useTransferQueue.getState().finish(b, 'error', 'x')

    // running survivor
    const c = useTransferQueue.getState().enqueue({
      id: '',
      kind: 'upload',
      name: 'c',
      localPath: '/c',
      remotePath: '/c',
      sessionId: 's1',
    })

    useTransferQueue.getState().clearFinished()
    const remaining = useTransferQueue.getState().transfers.map(t => t.id)
    expect(remaining).toEqual([c])
  })

  it('togglePanel flips panelOpen', () => {
    expect(useTransferQueue.getState().panelOpen).toBe(false)
    useTransferQueue.getState().togglePanel()
    expect(useTransferQueue.getState().panelOpen).toBe(true)
    useTransferQueue.getState().togglePanel()
    expect(useTransferQueue.getState().panelOpen).toBe(false)
  })
})
