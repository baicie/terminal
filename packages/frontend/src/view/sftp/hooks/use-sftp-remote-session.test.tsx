// UX-1c — INV-14 at the hook level.
//
// `sftp-transfer-session-guard.test.ts` proves the *predicate* is right. This file
// proves the hook actually consults it: unmounting the SFTP view while a transfer
// is running must leave the SSH session open, and must close it once the transfer
// settles.
//
// Testing this the other way round — asserting the code calls a function — would
// stay green if the call were deleted. These tests observe `sshService.close`,
// which is the only thing that can truncate a transfer.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTransferQueue } from '@/store/transfer-queue'
import type { TransferRecord } from '@/store/transfer-queue'

const ssh = vi.hoisted(() => ({
  createSshSessionPassword: vi.fn(),
  createSshSessionKey: vi.fn(),
  close: vi.fn(async () => undefined),
  sftpConnect: vi.fn(async () => ({ success: true, message: '' })),
  sftpList: vi.fn(async () => ({ success: true, files: [] })),
}))

vi.mock('@/service/ssh', () => ({ sshService: ssh }))
vi.mock('@/components/ui/sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const { useSftpRemote } = await import('@/view/sftp/hooks/use-sftp-remote')

const HOST = { id: 'host-prod', name: 'prod', authType: 'password' }

function transfer(sessionId: string, status: TransferRecord['status']): TransferRecord {
  return {
    id: `t-${status}`,
    kind: 'upload',
    name: 'a.bin',
    localPath: '/tmp/a.bin',
    remotePath: '/srv/a.bin',
    sessionId,
    status,
    bytesDone: 0,
    bytesTotal: 100,
    speed: 0,
    startedAt: 1,
  }
}

describe('unmounting the SFTP view', () => {
  beforeEach(() => {
    ssh.close.mockClear()
    ssh.sftpConnect.mockResolvedValue({ success: true, message: '' })
    ssh.sftpList.mockResolvedValue({ success: true, files: [] })
    ssh.createSshSessionPassword.mockResolvedValue({
      success: true,
      sessionId: 'sess-1',
    })
    useTransferQueue.setState({ transfers: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
    useTransferQueue.setState({ transfers: [] })
  })

  async function mountAndConnect() {
    // Props form: `rerender` only reaches the hook through the props object, so
    // a zero-argument render would silently ignore every host switch.
    const hook = renderHook(
      (props: { activeHost: typeof HOST }) => useSftpRemote(props),
      { initialProps: { activeHost: HOST } },
    )
    // The mount effect lists `/`, which opens the SSH session and then the SFTP
    // subsystem. Two awaited ticks: one for the session promise, one for the
    // connect promise chained after it.
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    return hook
  }

  it('closes the session when nothing is transferring', async () => {
    const hook = await mountAndConnect()

    act(() => hook.unmount())

    expect(ssh.close).toHaveBeenCalledWith('sess-1')
  })

  it('keeps the session open while a transfer is running', async () => {
    const hook = await mountAndConnect()
    useTransferQueue.setState({ transfers: [transfer('sess-1', 'running')] })

    act(() => hook.unmount())

    // The defect this replaces closed it here and truncated the upload.
    expect(ssh.close).not.toHaveBeenCalled()
  })

  it('closes the session once the running transfer settles', async () => {
    vi.useFakeTimers()
    const hook = await mountAndConnect()
    useTransferQueue.setState({ transfers: [transfer('sess-1', 'running')] })

    act(() => hook.unmount())
    expect(ssh.close).not.toHaveBeenCalled()

    // The upload finishes while the panel is gone.
    act(() => useTransferQueue.setState({ transfers: [transfer('sess-1', 'done')] }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
    })

    expect(ssh.close).toHaveBeenCalledWith('sess-1')
  })

  it('keeps the session while a queued transfer is still waiting', async () => {
    const hook = await mountAndConnect()
    useTransferQueue.setState({ transfers: [transfer('sess-1', 'queued')] })

    act(() => hook.unmount())

    // A queued transfer has not opened its bytes yet, but it will.
    expect(ssh.close).not.toHaveBeenCalled()
  })

  it('closes a session whose transfers are all finished', async () => {
    const hook = await mountAndConnect()
    useTransferQueue.setState({ transfers: [transfer('sess-1', 'error')] })

    act(() => hook.unmount())

    expect(ssh.close).toHaveBeenCalledWith('sess-1')
  })

  it('closes a switched-away session when nothing is transferring', async () => {
    ssh.createSshSessionPassword
      .mockReset()
      .mockResolvedValueOnce({ success: true, sessionId: 'sess-1' })
      .mockResolvedValueOnce({ success: true, sessionId: 'sess-2' })
    const hook = await mountAndConnect()

    hook.rerender({
      activeHost: { id: 'host-staging', name: 'staging', authType: 'password' },
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(ssh.close).toHaveBeenCalledWith('sess-1')
  })

  it('defers the old session when a transfer is still using it', async () => {
    // Switching hosts is not a licence to truncate a transfer either. The old
    // connection stays open until its own transfers settle; the new host gets its
    // own session immediately, so the panel is usable right away.
    ssh.createSshSessionPassword
      .mockReset()
      .mockResolvedValueOnce({ success: true, sessionId: 'sess-1' })
      .mockResolvedValueOnce({ success: true, sessionId: 'sess-2' })
    const hook = await mountAndConnect()
    useTransferQueue.setState({ transfers: [transfer('sess-1', 'running')] })

    hook.rerender({
      activeHost: { id: 'host-staging', name: 'staging', authType: 'password' },
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(ssh.close).not.toHaveBeenCalledWith('sess-1')
    expect(ssh.createSshSessionPassword).toHaveBeenCalledTimes(2)
  })
})
