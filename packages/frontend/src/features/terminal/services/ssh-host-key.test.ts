import { invoke } from '@tauri-apps/api/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  learnSshHostKey,
  probeSshHostKey,
  probeSshHostKeyViaJump,
} from './ssh-host-key'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const rawProbeResult = {
  status: 'unknown' as const,
  host: 'server.example.com',
  port: 2222,
  algorithm: 'ssh-ed25519',
  fingerprint: 'SHA256:example',
  public_key: 'ssh-ed25519 AAAAexample',
}

beforeEach(() => {
  vi.mocked(invoke).mockReset()
})

describe('SSH host-key IPC service', () => {
  it('probes a host and maps the complete Rust response to camelCase', async () => {
    vi.mocked(invoke).mockResolvedValue(rawProbeResult)

    const result = await probeSshHostKey('server.example.com', 2222)

    expect(invoke).toHaveBeenCalledWith('ssh_host_key_probe', {
      host: 'server.example.com',
      port: 2222,
    })
    expect(result).toEqual({
      status: 'unknown',
      host: 'server.example.com',
      port: 2222,
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:example',
      publicKey: 'ssh-ed25519 AAAAexample',
    })
  })

  it('learns the selected key using Tauri camelCase arguments', async () => {
    vi.mocked(invoke).mockResolvedValue({
      ...rawProbeResult,
      status: 'trusted',
    })

    const result = await learnSshHostKey(
      'server.example.com',
      2222,
      'ssh-ed25519 AAAAexample',
    )

    expect(invoke).toHaveBeenCalledWith('ssh_host_key_learn', {
      host: 'server.example.com',
      port: 2222,
      publicKey: 'ssh-ed25519 AAAAexample',
    })
    expect(result).toEqual({
      status: 'trusted',
      host: 'server.example.com',
      port: 2222,
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:example',
      publicKey: 'ssh-ed25519 AAAAexample',
    })
  })

  it('probes the target through an authenticated and pinned jump host', async () => {
    vi.mocked(invoke).mockResolvedValue(rawProbeResult)

    await probeSshHostKeyViaJump('server.example.com', 2222, {
      host: 'jump.example.com',
      port: 22,
      username: 'operator',
      authType: 'key',
      password: 'key-passphrase',
      privateKey: 'private-key',
      certificate: null,
      expectedHostKey: 'ssh-ed25519 AAAAjump',
      targetAuthType: 'password',
    })

    expect(invoke).toHaveBeenCalledWith('ssh_host_key_probe_via_jump', {
      targetHost: 'server.example.com',
      targetPort: 2222,
      jumpHost: {
        host: 'jump.example.com',
        port: 22,
        username: 'operator',
        authType: 'key',
        password: 'key-passphrase',
        privateKey: 'private-key',
        certificate: null,
        expectedHostKey: 'ssh-ed25519 AAAAjump',
        targetAuthType: 'password',
      },
    })
  })
})
