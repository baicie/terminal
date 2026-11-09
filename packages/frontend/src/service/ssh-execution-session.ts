/**
 * Builds the session a snippet batch or script runs in.
 *
 * Hosts store their secrets in the vault now, and `getHostById` returns metadata
 * only. Resolving here — for the target and for the jump host — is what keeps
 * script execution working after that change; without it the IPC call carries no
 * credential at all and the connection fails with "password required".
 */

import type { ConnectionResult } from '@/features/terminal/types'
import { sessionService } from '@/features/terminal/services'
import { getHostById } from '@/service/database/hosts'
import type { Host } from '@/types'
import { withResolvedCredential } from '@/features/terminal/services/terminal-launcher'

const terminalSize = { cols: 80, rows: 24 }

export async function createExecutionSession(
  host: Host,
): Promise<ConnectionResult> {
  if (host.jumpHostId) {
    const jumpHost = await getHostById(host.jumpHostId)
    if (!jumpHost) {
      return {
        success: false,
        message: 'Configured jump host could not be resolved',
      }
    }
    return createJumpExecution(host, jumpHost)
  }

  const resolved = await withResolvedCredential(host)
  const options = { host: resolved, ...terminalSize }
  switch (resolved.authType) {
    case 'password':
      return sessionService.createSshPassword(options)
    case 'key':
      return sessionService.createSshKey(options)
    case 'agent':
      return sessionService.createSshAgent(options)
    case 'cert':
      return sessionService.createSshCert(options)
    default:
      return {
        success: false,
        message: `Unsupported auth type: ${resolved.authType}`,
      }
  }
}

/** The jump-host half of the same rule: both sides are resolved independently. */
async function createJumpExecution(
  host: Host,
  jumpHost: Host,
): Promise<ConnectionResult> {
  const [target, bastion] = await Promise.all([
    withResolvedCredential(host),
    withResolvedCredential(jumpHost),
  ])
  const jumpAuthType = host.jumpHostAuthType ?? bastion.authType
  return sessionService.createSshJump({
    targetHost: target,
    jumpHost: {
      host: bastion.hostname,
      port: bastion.port,
      username: bastion.username,
      authType: jumpAuthType,
      password: bastion.password,
      privateKey: bastion.privateKey,
      certificate: bastion.certificate,
      targetAuthType: target.authType,
    },
    ...terminalSize,
  })
}
