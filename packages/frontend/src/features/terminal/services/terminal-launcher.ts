import { invoke } from '@tauri-apps/api/core'
import type { Host } from '@/types'
import { SessionCredentialResolver } from '@/service/credential-boundary'
import type { HostMetadata } from '@/service/credential-boundary'
import { vaultSecretProvider } from '@/service/vault-secret-provider'
import type { TabType } from '../types'
import { traceStageAndWait } from '@/service/database/startup-trace'
import { buildSshJumpHostIpcConfig } from './ssh-jump-config'

export type TerminalShellIntegration = 'bash' | 'zsh'

export type TerminalProfilePayload = {
  startupCommand?: string
  environment?: Record<string, string>
  shellIntegration?: TerminalShellIntegration
}

/**
 * The one place a connection's secrets are resolved.
 *
 * A host object reaching this module may carry `password`/`privateKey` because the
 * user just typed them into a form. Otherwise `credentialRef` decides: absent means
 * "agent, or ask at connect time"; present means the vault must answer, and a vault
 * that cannot answer fails the connection with its own explanation rather than
 * sending an empty password that looks like a wrong one.
 *
 * Returns a copy of the host with the resolved secrets applied, so callers keep
 * using `host.password` / `host.privateKey` and cannot forget to resolve.
 */
async function withResolvedCredential(host: Host): Promise<Host> {
  if (host.authType === 'agent') return host
  if (host.password || host.privateKey) return host
  const ref = host.credentialRef ?? null
  if (ref === null || ref.kinds.length === 0) return host

  const metadata: HostMetadata = {
    id: host.id,
    name: host.name,
    hostname: host.hostname,
    port: host.port,
    username: host.username,
    authType: host.authType,
    credentialRef: ref,
  }
  const resolved = await new SessionCredentialResolver(vaultSecretProvider).resolve(
    metadata,
  )
  if (!resolved.ok) {
    // The reason is user-facing and never contains the secret.
    throw new Error(resolved.message)
  }
  return {
    ...host,
    password: resolved.credential.password,
    privateKey: resolved.credential.privateKey,
  }
}

export function profileForHost(host: Host): TerminalProfilePayload | undefined {
  const environment = host.environment
  const hasEnvironment = Boolean(environment && Object.keys(environment).length)
  const startupCommand = host.startupCommand?.trim()
  const shellIntegration =
    host.shellIntegration === 'bash' || host.shellIntegration === 'zsh'
      ? host.shellIntegration
      : undefined
  if (!hasEnvironment && !startupCommand && !shellIntegration) return undefined
  return {
    ...(startupCommand ? { startupCommand } : {}),
    ...(hasEnvironment ? { environment } : {}),
    ...(shellIntegration ? { shellIntegration } : {}),
  }
}

/**
 * The frontend half of the staged startup timeline (#65).
 *
 * A readiness deadline cannot tell "the UI never asked for a session" apart
 * from "the backend is slow" unless the request itself is timestamped, and the
 * two need opposite fixes.
 */
export async function startTerminalShell(
  tabType: TabType,
  host: Host | undefined,
  serialSessionId: string | undefined,
  cols: number,
  rows: number,
  jumpHost?: Host,
  expectedHostKey?: string,
  expectedJumpHostKey?: string,
  attemptId?: string,
  connectionTimeoutMs?: number,
): Promise<string> {
  await traceStageAndWait('session-create-requested', tabType)
  const sessionId = await createTerminalShell(
    tabType,
    host,
    serialSessionId,
    cols,
    rows,
    jumpHost,
    expectedHostKey,
    expectedJumpHostKey,
    attemptId,
    connectionTimeoutMs,
  )
  await traceStageAndWait('session-created', sessionId)
  return sessionId
}

async function createTerminalShell(
  tabType: TabType,
  host: Host | undefined,
  serialSessionId: string | undefined,
  cols: number,
  rows: number,
  jumpHost?: Host,
  expectedHostKey?: string,
  expectedJumpHostKey?: string,
  attemptId?: string,
  connectionTimeoutMs?: number,
): Promise<string> {
  if (tabType === 'local') {
    return invoke<string>('session_create_local', { cols, rows })
  }

  if (tabType === 'remote') {
    if (!host) throw new Error('Host info required for remote connection')
    // Both sides of a jump connection resolve their own secrets: they are
    // different hosts and may store different kinds.
    host = await withResolvedCredential(host)
    const resolvedJump =
      jumpHost === undefined ? undefined : await withResolvedCredential(jumpHost)
    jumpHost = resolvedJump
    const profile = profileForHost(host)
    if (host.jumpHostId) {
      if (!jumpHost || jumpHost.id !== host.jumpHostId) {
        throw new Error('Configured jump host could not be resolved')
      }
      return invoke<string>('session_create_ssh_jump', {
        targetHost: host.hostname,
        targetPort: host.port,
        targetUsername: host.username,
        targetPassword: host.password ?? null,
        targetPrivateKey: host.privateKey ?? null,
        targetCertificate:
          host.authType === 'cert' ? (host.certificate ?? null) : null,
        agentForwarding: host.agentForwarding ?? false,
        ...(expectedHostKey === undefined ? {} : { expectedHostKey }),
        ...(profile ? { profile } : {}),
        jumpHost: buildSshJumpHostIpcConfig(
          host,
          jumpHost,
          expectedJumpHostKey,
        ),
        cols,
        rows,
        ...(attemptId ? { attemptId } : {}),
        ...(connectionTimeoutMs === undefined ? {} : { connectionTimeoutMs }),
      })
    }

    const base = {
      host: host.hostname,
      port: host.port,
      username: host.username,
      agentForwarding: host.agentForwarding ?? false,
      ...(expectedHostKey === undefined ? {} : { expectedHostKey }),
      cols,
      rows,
      ...(profile ? { profile } : {}),
      ...(attemptId ? { attemptId } : {}),
      ...(connectionTimeoutMs === undefined ? {} : { connectionTimeoutMs }),
    }
    if (host.authType === 'password') {
      return invoke<string>('session_create_ssh_password', {
        ...base,
        password: host.password,
      })
    }
    if (host.authType === 'key') {
      return invoke<string>('session_create_ssh_key', {
        ...base,
        privateKey: host.privateKey ?? '',
        password: host.password ?? null,
      })
    }
    if (host.authType === 'agent') {
      return invoke<string>('session_create_ssh_agent', base)
    }
    if (host.authType === 'cert') {
      return invoke<string>('session_create_ssh_cert', {
        ...base,
        certificate: host.certificate ?? '',
        privateKey: host.privateKey ?? '',
        password: host.password ?? null,
      })
    }
    throw new Error('Unsupported auth type: ' + host.authType)
  }

  if (tabType === 'serial') {
    if (!serialSessionId) throw new Error('Serial session ID required')
    return serialSessionId
  }

  throw new Error('Unknown tab type: ' + tabType)
}
