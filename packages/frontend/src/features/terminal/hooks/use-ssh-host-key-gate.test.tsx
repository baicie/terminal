import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SshHostKeyProbeResult } from '@/features/terminal/services/ssh-host-key'
import type { Host } from '@/types'
import {
  isRetryableSshHostKeyProbeError,
  SSH_HOST_KEY_PROBE_RETRY_DELAYS_MS,
  useSshHostKeyGate,
} from './use-ssh-host-key-gate'

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

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not gate local terminals', () => {
    const { result } = renderHook(() => useSshHostKeyGate({ tabType: 'local' }))

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
    expect(mocks.probe).toHaveBeenCalledWith(
      host.hostname,
      host.port,
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    )
  })

  it('does not release a trusted result that arrives after the shared deadline', async () => {
    vi.useFakeTimers()
    const pending = deferred<SshHostKeyProbeResult>()
    mocks.probe.mockReturnValue(pending.promise)
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'remote', host }),
    )
    await act(async () => {
      await Promise.resolve()
    })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_001)
      pending.resolve({ ...unknownKey, status: 'trusted' })
      await pending.promise
      await Promise.resolve()
    })

    expect(result.current.enabled).toBe(false)
    expect(result.current.status).toBe('error')
    expect(result.current.error).toContain('startup deadline expired')
  })

  it('starts a fresh shared budget after the user resolves a trust prompt', async () => {
    vi.useFakeTimers()
    mocks.probe.mockResolvedValue(unknownKey)
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'remote', host }),
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.status).toBe('prompt')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000)
      result.current.trustOnce()
    })

    expect(result.current.enabled).toBe(true)
    expect(result.current.connectionDeadlineAt).toBeGreaterThan(
      performance.now() + 9_900,
    )
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
      .mockRejectedValueOnce({
        type: 'known_hosts_failed',
        message: 'known_hosts file is not valid',
      })
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

  it('routes a non-transient probe failure into the error state', async () => {
    mocks.probe
      .mockRejectedValueOnce({
        type: 'known_hosts_failed',
        message: 'known_hosts file is not valid',
      })
      .mockResolvedValueOnce({ ...unknownKey, status: 'trusted' })
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'remote', host }),
    )

    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.error).toContain('known_hosts')

    act(() => result.current.retry())
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.enabled).toBe(true)
    expect(mocks.probe).toHaveBeenCalledTimes(2)
  })

  it('automatically retries a transient outage and enables the gate', async () => {
    mocks.probe
      .mockRejectedValueOnce({
        type: 'connection_failed',
        message: 'SSH host-key connection failed: connection refused',
      })
      .mockResolvedValueOnce({ ...unknownKey, status: 'trusted' })
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'remote', host }),
    )

    await waitFor(() => expect(result.current.status).toBe('ready'), {
      timeout: SSH_HOST_KEY_PROBE_RETRY_DELAYS_MS[0] + 1_000,
    })

    expect(result.current.enabled).toBe(true)
    expect(mocks.probe).toHaveBeenCalledTimes(2)
  })

  it('stops after the bounded automatic retry budget is exhausted', async () => {
    vi.useFakeTimers()
    mocks.probe.mockRejectedValue({
      type: 'connection_failed',
      message: 'SSH host-key connection failed: connection timed out',
    })
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'remote', host }),
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(mocks.probe).toHaveBeenCalledTimes(1)

    for (const delay of SSH_HOST_KEY_PROBE_RETRY_DELAYS_MS) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(delay)
        await Promise.resolve()
        await Promise.resolve()
      })
    }

    expect(mocks.probe).toHaveBeenCalledTimes(
      SSH_HOST_KEY_PROBE_RETRY_DELAYS_MS.length + 1,
    )
    expect(result.current.status).toBe('error')
    expect(result.current.enabled).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it.each([
    [
      'WSAECONNRESET',
      'SSH host-key connection failed: An existing connection was forcibly closed by the remote host. (os error 10054)',
    ],
    [
      'WSAETIMEDOUT',
      'connect host-key probe failed: The semaphore timeout period has expired. (os error 121)',
    ],
    [
      'WSAECONNREFUSED',
      'connect host-key probe failed: No connection could be made because the target machine actively refused it. (os error 10061)',
    ],
    [
      'WSAHOST_NOT_FOUND',
      'connect host-key probe failed: No such host is known. (os error 11001)',
    ],
  ])('classifies Windows %s as retryable', (_name, message) => {
    expect(
      isRetryableSshHostKeyProbeError({
        type: 'connection_failed',
        message,
      }),
    ).toBe(true)
  })

  it('does not retry Windows authentication rejection text just because it contains a network code', () => {
    expect(
      isRetryableSshHostKeyProbeError({
        type: 'authentication_failed',
        message: 'credentials rejected by server (os error 10061)',
      }),
    ).toBe(false)
  })

  it('does not classify a host address containing a timeout code as transient', () => {
    expect(
      isRetryableSshHostKeyProbeError({
        type: 'connection_failed',
        message: 'server 192.0.2.121 did not present a host key',
      }),
    ).toBe(false)
  })

  it('retries authentication transport timeouts but not rejected credentials', () => {
    expect(
      isRetryableSshHostKeyProbeError({
        type: 'authentication_failed',
        message: 'SSH authentication timed out before its deadline',
      }),
    ).toBe(true)
    expect(
      isRetryableSshHostKeyProbeError({
        type: 'authentication_failed',
        message: 'credentials rejected: permission denied',
      }),
    ).toBe(false)
  })

  it('classifies a Windows known_hosts timeout as retryable', () => {
    expect(
      isRetryableSshHostKeyProbeError({
        type: 'known_hosts_failed',
        message: 'known_hosts operation failed (os error 121)',
      }),
    ).toBe(true)
  })

  it('disables the gate immediately while a changed host revision is rechecked', async () => {
    const pending = deferred<SshHostKeyProbeResult>()
    mocks.probe
      .mockResolvedValueOnce({ ...unknownKey, status: 'trusted' })
      .mockReturnValueOnce(pending.promise)
    const { result, rerender } = renderHook(
      ({ currentHost }) =>
        useSshHostKeyGate({ tabType: 'remote', host: currentHost }),
      { initialProps: { currentHost: host } },
    )
    await waitFor(() => expect(result.current.enabled).toBe(true))

    rerender({ currentHost: { ...host, updatedAt: 2 } })

    expect(result.current.enabled).toBe(false)

    await act(async () => {
      pending.resolve({ ...unknownKey, status: 'trusted' })
      await pending.promise
    })
    await waitFor(() => expect(result.current.enabled).toBe(true))
  })

  it('keeps host-key and known_hosts data errors as hard failures', async () => {
    vi.useFakeTimers()
    mocks.probe.mockRejectedValueOnce({
      type: 'known_hosts_failed',
      message: 'known_hosts file is not valid',
    })
    const { result } = renderHook(() =>
      useSshHostKeyGate({ tabType: 'remote', host }),
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.status).toBe('error')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        SSH_HOST_KEY_PROBE_RETRY_DELAYS_MS.at(-1) ?? 0,
      )
    })

    expect(mocks.probe).toHaveBeenCalledTimes(1)
    expect(result.current.enabled).toBe(false)
    expect(
      isRetryableSshHostKeyProbeError({
        type: 'host_key_changed',
        message: 'refusing to replace the existing key',
      }),
    ).toBe(false)
    expect(
      isRetryableSshHostKeyProbeError({
        type: 'known_hosts_failed',
        message: 'known_hosts file is not valid',
      }),
    ).toBe(false)
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

    expect(mocks.probe).toHaveBeenCalledWith(
      jumpHost.hostname,
      jumpHost.port,
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    )
    expect(mocks.probeViaJump).toHaveBeenCalledWith(
      host.hostname,
      host.port,
      expect.objectContaining({
        host: jumpHost.hostname,
      }),
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
    )
    expect(mocks.probeViaJump.mock.calls[0]?.[2]).not.toHaveProperty(
      'expectedHostKey',
    )
    expect(result.current.expectedHostKey).toBeUndefined()
    expect(result.current.expectedJumpHostKey).toBeUndefined()
  })

  it('charges the jump preflight and target tunnel probe to one startup budget', async () => {
    vi.useFakeTimers()
    const pendingJump = deferred<SshHostKeyProbeResult>()
    mocks.probe.mockReturnValue(pendingJump.promise)
    mocks.probeViaJump.mockResolvedValue({ ...unknownKey, status: 'trusted' })
    const { result } = renderHook(() =>
      useSshHostKeyGate({
        tabType: 'remote',
        host: targetViaJump,
        jumpHost,
      }),
    )
    await act(async () => {
      await Promise.resolve()
    })
    const jumpBudget = mocks.probe.mock.calls[0]?.[2]?.timeoutMs as number

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
      pendingJump.resolve({ ...unknownJumpKey, status: 'trusted' })
      await pendingJump.promise
      await Promise.resolve()
      await Promise.resolve()
    })

    const targetBudget = mocks.probeViaJump.mock.calls[0]?.[3]
      ?.timeoutMs as number
    expect(targetBudget).toBeLessThan(jumpBudget - 1_900)
    expect(result.current.status).toBe('ready')
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
      expect.objectContaining({ timeoutMs: expect.any(Number) }),
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
