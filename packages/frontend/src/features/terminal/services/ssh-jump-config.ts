import type { Host } from '@/types'

export interface SshJumpHostIpcConfig {
  host: string
  port: number
  username: string
  authType: Host['authType']
  password: string | null
  privateKey: string | null
  certificate: string | null
  expectedHostKey?: string
  targetAuthType: Host['authType']
}

export function buildSshJumpHostIpcConfig(
  target: Host,
  jumpHost: Host,
  expectedHostKey?: string,
): SshJumpHostIpcConfig {
  return {
    host: jumpHost.hostname,
    port: jumpHost.port,
    username: jumpHost.username,
    authType: target.jumpHostAuthType ?? jumpHost.authType,
    password: jumpHost.password ?? null,
    privateKey: jumpHost.privateKey ?? null,
    certificate: jumpHost.certificate ?? null,
    ...(expectedHostKey === undefined ? {} : { expectedHostKey }),
    targetAuthType: target.authType,
  }
}
