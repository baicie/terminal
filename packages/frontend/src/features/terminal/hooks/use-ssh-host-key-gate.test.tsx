import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshHostKeyProbeResult } from '@/features/terminal/services/ssh-host-key'
import type { Host } from '@/types'
import { useSshHostKeyGate } from './use-ssh-host-key-gate'

const mocks = vi.hoisted(() => ({
  probe: vi.fn(),
  probeViaJump: vi.fn(),
  learn: vi.fn(),
}))

vi.mock('@/features/terminal/services/ssh-host-key', () => ({
  probeSshHostKey: mocks.probe,
  probeSshHostKeyViaJump: mocks.probeViaJump,
  learnSshHostKey: mocks.learn,
}))

const host: Host = {
  id: 'host-1',
  name: 'Server',
  hostname: 'server.example.com',
  port: 22,
  username: 'deploy',
  authType: 'agent',
  isFavorite: false,
  portForwards: [],
  createdAt: 1,
  updatedAt: 1,
}

const unknownKey = {
  status: 'unknown' as const,
  host: host.hostname,
  port: host.port,
  algorithm: 'ssh-ed25519',
  fingerprint: 'SHA256:unknown-key',
  publicKey: 'ssh-ed25519 AAAAunknown',
}

const jumpHost: Host = {
  ...host,
  id: 'jump-1',
  name: 'Bastion',
  hostname: 'jump.example.com',
  username: 'operator',
  authType: 'key',
  password: 'key-passphrase',
  privateKey: 'jump-private-key',
}

const targetViaJump: Host = {
  ...host,
  jumpHostId: jumpHost.id,
  jumpHostAuthType: 'key',
}

const unknownJumpKey = {
  ...unknownKey,
  host: jumpHost.hostname,
  port: jumpHost.port,
  fingerprint: 'SHA256:unknown-jump-key',
  publicKey: 'ssh-ed25519 AAAAunknown-jump',
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('useSshHostKeyGate', () => {
  beforeEach(() => {
    mocks.probe.mockReset()
    mocks.probeViaJump.mockReset()
    mocks.learn.mockReset()
  })

  it('does not gate local terminals', () => {
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'local' }),
    )

    expect(result.current.enabled).toBe(true)
    expect(result.current.status).toBe('ready')
    expect(mocks.probe).not.toHaveBeenCalled()
  })

  it('enables a remote session after a trusted preflight', async () => {
    mocks.probe.mockResolvedValue({ ...unknownKey, status: 'trusted' })
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'remote', host }),
    )

    expect(result.current.enabled).toBe(false)
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(result.current.enabled).toBe(true)
    expect(result.current.expectedHostKey).toBeUndefined()
    expect(mocks.probe).toHaveBeenCalledWith(host.hostname, host.port)
  })

  it('pins the exact preflight key when trusted for this session only', async () => {
    mocks.probe.mockResolvedValue(unknownKey)
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'remote', host }),
    )
    await waitFor(() => expect(result.current.status).toBe('prompt'))

    act(() => result.current.trustOnce())

    expect(result.current.enabled).toBe(true)
    expect(result.current.expectedHostKey).toBe(unknownKey.publicKey)
    expect(mocks.learn).not.toHaveBeenCalled()
  })

  it('learns an unknown key before enabling the normal known_hosts path', async () => {
    mocks.probe.mockResolvedValue(unknownKey)
    mocks.learn.mockResolvedValue({ ...unknownKey, status: 'trusted' })
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'remote', host }),
    )
    await waitFor(() => expect(result.current.status).toBe('prompt'))

    await act(() => result.current.trustAndSave())

    expect(mocks.learn).toHaveBeenCalledWith(
      host.hostname,
      host.port,
      unknownKey.publicKey,
    )
    expect(result.current.enabled).toBe(true)
    expect(result.current.expectedHostKey).toBeUndefined()
  })

  it('never allows a changed key through the trust-once action', async () => {
    mocks.probe.mockResolvedValue({ ...unknownKey, status: 'changed' })
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'remote', host }),
    )
    await waitFor(() => expect(result.current.status).toBe('blocked'))

    act(() => result.current.trustOnce())
    await act(() => result.current.trustAndSave())

    expect(result.current.enabled).toBe(false)
    expect(result.current.expectedHostKey).toBeUndefined()
    expect(mocks.learn).not.toHaveBeenCalled()
  })

  it('retries the preflight after a recoverable probe error', async () => {
    mocks.probe
      .mockRejectedValueOnce(new Error('network offline'))
      .mockResolvedValueOnce({ ...unknownKey, status: 'trusted' })
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'remote', host }),
    )
    await waitFor(() => expect(result.current.status).toBe('error'))

    act(() => result.current.retry())

    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.enabled).toBe(true)
    expect(mocks.probe).toHaveBeenCalledTimes(2)
  })

  it('does not let a stale learn result approve another host with the same key', async () => {
    const save = deferred<SshHostKeyProbeResult>()
    const otherHost = {
      ...host,
      id: 'host-2',
      hostname: 'other.example.com',
      port: 2222,
    }
    const otherUnknownKey = {
      ...unknownKey,
      host: otherHost.hostname,
      port: otherHost.port,
    }
    mocks.probe
      .mockResolvedValueOnce(unknownKey)
      .mockResolvedValueOnce(otherUnknownKey)
    mocks.learn.mockReturnValue(save.promise)
    const { result, rerender } = renderHook(
      ({ currentHost }) =>
        useSshHostKeyGate({ tabType: 'remote', host: currentHost }),
      { initialProps: { currentHost: host } },
    )
    await waitFor(() => expect(result.current.status).toBe('prompt'))

    let savePromise!: Promise<void>
    act(() => {
      savePromise = result.current.trustAndSave()
    })
    rerender({ currentHost: otherHost })
    await waitFor(() =>
      expect(result.current.prompt?.host).toBe(otherHost.hostname),
    )

    await act(async () => {
      save.resolve({ ...unknownKey, status: 'trusted' })
      await savePromise
    })

    expect(result.current.status).toBe('prompt')
    expect(result.current.enabled).toBe(false)
  })

  it('does not let a stale learn result release a changed-key block', async () => {
    const save = deferred<SshHostKeyProbeResult>()
    mocks.probe
      .mockResolvedValueOnce(unknownKey)
      .mockResolvedValueOnce({ ...unknownKey, status: 'changed' })
    mocks.learn.mockReturnValue(save.promise)
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'remote', host }),
    )
    await waitFor(() => expect(result.current.status).toBe('prompt'))

    let savePromise!: Promise<void>
    act(() => {
      savePromise = result.current.trustAndSave()
      result.current.retry()
    })
    await waitFor(() => expect(result.current.status).toBe('blocked'))

    await act(async () => {
      save.resolve({ ...unknownKey, status: 'trusted' })
      await savePromise
    })

    expect(result.current.status).toBe('blocked')
    expect(result.current.enabled).toBe(false)
  })

  it('checks a trusted jump host before probing the target through its tunnel', async () => {
    mocks.probe.mockResolvedValue({ ...unknownJumpKey, status: 'trusted' })
    mocks.probeViaJump.mockResolvedValue({ ...unknownKey, status: 'trusted' })
    const { result } = renderHook(() =>
      useSshHostKeyGate({
        tabType: 'remote',
        host: targetViaJump,
        jumpHost,
      }),
    )

    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(mocks.probe).toHaveBeenCalledWith(jumpHost.hostname, jumpHost.port)
    expect(mocks.probeViaJump).toHaveBeenCalledWith(
      host.hostname,
      host.port,
      expect.objectContaining({
        host: jumpHost.hostname,
      }),
    )
    expect(mocks.probeViaJump.mock.calls[0]?.[2]).not.toHaveProperty(
      'expectedHostKey',
    )
    expect(result.current.expectedHostKey).toBeUndefined()
    expect(result.current.expectedJumpHostKey).toBeUndefined()
  })

  it('pins both trust-once keys across jump and target preflights', async () => {
    mocks.probe.mockResolvedValue(unknownJumpKey)
    mocks.probeViaJump.mockResolvedValue(unknownKey)
    const { result } = renderHook(() =>
      useSshHostKeyGate({
        tabType: 'remote',
        host: targetViaJump,
        jumpHost,
      }),
    )
    await waitFor(() =>
      expect(result.current.prompt?.host).toBe(jumpHost.hostname),
    )

    act(() => result.current.trustOnce())
    await waitFor(() => expect(result.current.prompt?.host).toBe(host.hostname))

    expect(mocks.probeViaJump).toHaveBeenCalledWith(
      host.hostname,
      host.port,
      expect.objectContaining({ expectedHostKey: unknownJumpKey.publicKey }),
    )
    act(() => result.current.trustOnce())

    expect(result.current.enabled).toBe(true)
    expect(result.current.expectedJumpHostKey).toBe(unknownJumpKey.publicKey)
    expect(result.current.expectedHostKey).toBe(unknownKey.publicKey)
  })

  it('never probes the target when the jump host key has changed', async () => {
    mocks.probe.mockResolvedValue({ ...unknownJumpKey, status: 'changed' })
    const { result } = renderHook(() =>
      useSshHostKeyGate({
        tabType: 'remote',
        host: targetViaJump,
        jumpHost,
      }),
    )

    await waitFor(() => expect(result.current.status).toBe('blocked'))

    expect(result.current.prompt?.host).toBe(jumpHost.hostname)
    expect(mocks.probeViaJump).not.toHaveBeenCalled()
  })

  it('fails closed when the configured jump host cannot be resolved', async () => {
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'remote', host: targetViaJump }),
    )

    await waitFor(() => expect(result.current.status).toBe('error'))

    expect(result.current.error).toContain('could not be resolved')
    expect(mocks.probe).not.toHaveBeenCalled()
    expect(mocks.probeViaJump).not.toHaveBeenCalled()
  })

  it('uses known_hosts after saving the jump key before probing the target', async () => {
    mocks.probe.mockResolvedValue(unknownJumpKey)
    mocks.learn.mockResolvedValue({ ...unknownJumpKey, status: 'trusted' })
    mocks.probeViaJump.mockResolvedValue({ ...unknownKey, status: 'trusted' })
    const { result } = renderHook(() =>
      useSshHostKeyGate({
        tabType: 'remote',
        host: targetViaJump,
        jumpHost,
      }),
    )
    await waitFor(() => expect(result.current.status).toBe('prompt'))

    await act(() => result.current.trustAndSave())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(mocks.learn).toHaveBeenCalledWith(
      jumpHost.hostname,
      jumpHost.port,
      unknownJumpKey.publicKey,
    )
    expect(mocks.probeViaJump.mock.calls[0]?.[2]).not.toHaveProperty(
      'expectedHostKey',
    )
    expect(result.current.expectedJumpHostKey).toBeUndefined()
  })

  it('keeps a trust-once jump pin when the target key is saved', async () => {
    mocks.probe.mockResolvedValue(unknownJumpKey)
    mocks.probeViaJump.mockResolvedValue(unknownKey)
    mocks.learn.mockResolvedValue({ ...unknownKey, status: 'trusted' })
    const { result } = renderHook(() =>
      useSshHostKeyGate({
        tabType: 'remote',
        host: targetViaJump,
        jumpHost,
      }),
    )
    await waitFor(() => expect(result.current.status).toBe('prompt'))
    act(() => result.current.trustOnce())
    await waitFor(() => expect(result.current.prompt?.host).toBe(host.hostname))

    await act(() => result.current.trustAndSave())

    expect(result.current.status).toBe('ready')
    expect(result.current.expectedJumpHostKey).toBe(unknownJumpKey.publicKey)
    expect(result.current.expectedHostKey).toBeUndefined()
  })

  it('blocks a changed target key after the jump host is trusted', async () => {
    mocks.probe.mockResolvedValue({ ...unknownJumpKey, status: 'trusted' })
    mocks.probeViaJump.mockResolvedValue({ ...unknownKey, status: 'changed' })
    const { result } = renderHook(() =>
      useSshHostKeyGate({
        tabType: 'remote',
        host: targetViaJump,
        jumpHost,
      }),
    )

    await waitFor(() => expect(result.current.status).toBe('blocked'))

    expect(result.current.prompt?.host).toBe(host.hostname)
    act(() => result.current.trustOnce())
    await act(() => result.current.trustAndSave())
    expect(result.current.enabled).toBe(false)
  })

  it('preserves the approved jump pin when retrying a target probe', async () => {
    mocks.probe.mockResolvedValue(unknownJumpKey)
    mocks.probeViaJump
      .mockRejectedValueOnce(new Error('tunnel reset'))
      .mockResolvedValueOnce({ ...unknownKey, status: 'trusted' })
    const { result } = renderHook(() =>
      useSshHostKeyGate({
        tabType: 'remote',
        host: targetViaJump,
        jumpHost,
      }),
    )
    await waitFor(() => expect(result.current.status).toBe('prompt'))
    act(() => result.current.trustOnce())
    await waitFor(() => expect(result.current.status).toBe('error'))

    act(() => result.current.retry())
    await waitFor(() => expect(result.current.status).toBe('ready'))

    expect(mocks.probeViaJump).toHaveBeenCalledTimes(2)
    expect(mocks.probeViaJump.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({ expectedHostKey: unknownJumpKey.publicKey }),
    )
    expect(result.current.expectedJumpHostKey).toBe(unknownJumpKey.publicKey)
  })
})
