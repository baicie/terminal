import type { TFunction } from 'i18next'

export function getReadableTerminalError(msg: string, t: TFunction): string {
  const m = msg.toLowerCase()

  // --- SSH Agent: Pipe / Service not running ---
  if (
    m.includes('openssh authentication agent') ||
    m.includes('windows openssh') ||
    (m.includes('not running') && m.includes('agent'))
  ) {
    return t('terminal.agentNotRunning')
  }
  if (
    m.includes('pageant') &&
    (m.includes('does not appear to be running') || m.includes('not running'))
  ) {
    return t('terminal.agentPageantNotRunning')
  }
  if (m.includes('ssh_auth_sock') && m.includes('was not found')) {
    return t('terminal.agentSockInvalid')
  }
  if (
    m.includes('ssh_auth_sock points') &&
    (m.includes('was not found') || m.includes('pipe was not found'))
  ) {
    return t('terminal.agentSockInvalid')
  }
  if (m.includes('permission denied') && m.includes('ssh agent')) {
    return t('terminal.agentPermissionDenied')
  }
  if (m.includes('access denied') && m.includes('ssh agent')) {
    return t('terminal.agentAccessDenied')
  }
  if (m.includes('is not available') && m.includes('ssh agent')) {
    return t('terminal.agentNotAvailable')
  }

  // --- SSH Agent: Identity-level errors ---
  if (m.includes('no ssh agent pipe found') || m.includes('no agent pipe')) {
    return t('terminal.agentNoPipe')
  }
  if (m.includes('ssh agent has no available identities') || m.includes('no available identities')) {
    return t('terminal.agentNoIdentities')
  }
  if (m.includes('all ssh agent identities rejected')) {
    return t('terminal.agentRejected')
  }
  if (m.includes('failed to read identities from ssh agent')) {
    return t('terminal.agentReadFailed')
  }
  if (m.includes('agent auth failed') || m.includes('authentication failed:')) {
    return t('terminal.agentAuthFailed')
  }

  // --- SSH Agent: Unix-specific ---
  if (
    m.includes('failed to connect ssh agent') &&
    (m.includes('enoent') || m.includes('no such file'))
  ) {
    return t('terminal.agentUnixNoSocket')
  }

  // --- General SSH errors ---
  if (
    m.includes('connection refused') ||
    m.includes('connection reset') ||
    m.includes('connection timed out')
  ) {
    return t('terminal.connectionFailed')
  }
  if (m.includes('authentication failed') || m.includes('all methods rejected')) {
    return t('terminal.authFailed')
  }
  if (m.includes('host key verification failed') || m.includes('known hosts')) {
    return t('terminal.hostKeyFailed')
  }
  if (m.includes('timeout') && m.includes('session')) {
    return t('terminal.sessionTimeout')
  }

  return msg
}
