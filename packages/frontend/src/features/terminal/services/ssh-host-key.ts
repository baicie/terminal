import { invoke } from '@tauri-apps/api/core'
import type { SshJumpHostIpcConfig } from './ssh-jump-config'

export type SshHostKeyStatus = 'trusted' | 'unknown' | 'changed'

export interface SshHostKeyProbeResult {
  status: SshHostKeyStatus
  host: string
  port: number
  algorithm: string
  fingerprint: string
  publicKey: string
}

interface SshHostKeyWireResult {
  status: SshHostKeyStatus
  host: string
  port: number
  algorithm: string
  fingerprint: string
  public_key: string
}

function fromWireResult(result: SshHostKeyWireResult): SshHostKeyProbeResult {
  return {
    status: result.status,
    host: result.host,
    port: result.port,
    algorithm: result.algorithm,
    fingerprint: result.fingerprint,
    publicKey: result.public_key,
  }
}

export async function probeSshHostKey(
  host: string,
  port: number,
): Promise<SshHostKeyProbeResult> {
  const result = await invoke<SshHostKeyWireResult>('ssh_host_key_probe', {
    host,
    port,
  })
  return fromWireResult(result)
}

export async function probeSshHostKeyViaJump(
  targetHost: string,
  targetPort: number,
  jumpHost: SshJumpHostIpcConfig,
): Promise<SshHostKeyProbeResult> {
  const result = await invoke<SshHostKeyWireResult>(
    'ssh_host_key_probe_via_jump',
    { targetHost, targetPort, jumpHost },
  )
  return fromWireResult(result)
}

export async function learnSshHostKey(
  host: string,
  port: number,
  publicKey: string,
): Promise<SshHostKeyProbeResult> {
  const result = await invoke<SshHostKeyWireResult>('ssh_host_key_learn', {
    host,
    port,
    publicKey,
  })
  return fromWireResult(result)
}
