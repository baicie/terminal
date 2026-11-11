import { invoke } from '@tauri-apps/api/core'
import type { Host } from '@/types'
import type { TabType } from '../types'
import { resolveSessionCredential, describeRefProblem } from './session-credentials'
import { traceStageAndWait } from '@/service/database/startup-trace'
import { buildSshJumpHostIpcConfig } from './ssh-jump-config'
import { CredentialFailure, credentialFailureFrom } from './credential-failure'

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
export async function withResolvedCredential(host: Host): Promise<Host> {
  if (host.authType === 'agent') return host
  if (host.password || host.privateKey) return host
  // A damaged reference is checked *before* the "no reference → nothing stored"
  // early return. Both look like `credentialRef === null` coming out of the mapper,
  // so checking only the reference here silently treated a corrupt pointer as "this
  // host stores nothing" and sent an empty password — the exact failure the
  // three-state parse exists to prevent. This is the function the terminal actually
  // calls, so the guard has to live here, not only inside the resolver.
  if (host.credentialRefProblem) {
    // A `CredentialFailure`, not a bare `Error`: a damaged reference is the
    // sixth kind the pane maps to "re-save the credential", and this is its only
    // producer. Throwing a plain Error here meant the enum member existed for
    // nothing — the classifier fell through to message matching, the session
    // spent its full five-attempt reconnect budget on a row that cannot be fixed
    // by waiting, and the header had no action to offer.
    throw new CredentialFailure(
      'credential-corrupt-reference',
      describeRefProblem(host.credentialRefProblem),
    )
  }

  // An imported host can carry a key *path* instead of a credential. It looks
  // configured — hostname, user, auth type — and is not connectable: the app does
  // not read files during a connection attempt, and the row holds no secret.
  //
  // This guard has to sit above the "no reference" early return. Below it (where
  // it was, inside the resolver) it never ran: a host with a path has no
  // reference, so the launcher returned it unchanged and started a session with
  // an empty key. The error then described a key parse failure rather than the
  // one thing the user could actually fix.
  if (host.identityFilePath) {
    throw new CredentialFailure(
      'credential-not-bound',
      `This host was imported with the key file ${host.identityFilePath}, which ` +
        'has not been bound yet. Open the host and paste the key, or connect ' +
        'with the SSH agent instead.',
    )
  }

  const ref = host.credentialRef ?? null
  if (ref === null || ref.kinds.length === 0) return host

  // One implementation, shared with the script/batch path, so a change to the
  // resolution rule cannot apply to the terminal and miss the exec path.
  const resolved = await resolveSessionCredential(host)
  if (!resolved.ok) {
    // The reason is user-facing and never contains the secret. It is also
    // structured: a locked vault must not be retried as if it were a network
    // blip, and the classifier can only tell the two apart if it receives the
    // kind rather than a sentence.
    throw resolved.reason !== undefined
      ? credentialFailureFrom({
          ok: false,
          reason: resolved.reason,
          message: resolved.message,
          // `state` is the whole point of making the vault availability
          // structured: dropping it here would send a first-run user to unlock a
          // vault that does not exist, which is the defect this field replaces.
          ...(resolved.vaultState === undefined
            ? {}
            : { state: resolved.vaultState }),
          ...(resolved.reason === 'read-failed' ? { cause: null } : {}),
        } as Parameters<typeof credentialFailureFrom>[0])
      : new CredentialFailure('credential-missing', resolved.message)
  }
  return {
    ...host,
    password: resolved.password,
    privateKey: resolved.privateKey,
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
      jumpHost === undefined
        ? undefined
        : await withResolvedCredential(jumpHost)
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
