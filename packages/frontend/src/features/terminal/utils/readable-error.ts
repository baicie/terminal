import type { TFunction } from 'i18next'

export function getReadableTerminalError(msg: string, t: TFunction): string {
  const m = msg.toLowerCase()
  if (m.includes('no ssh agent pipe found')) {
    return t('terminal.agentNoPipe')
  }
  if (m.includes('ssh_auth_sock points') && m.includes('pipe was not found')) {
    return t('terminal.agentSockInvalid')
  }
  if (m.includes('permission denied when opening ssh agent pipe')) {
    return t('terminal.agentPermissionDenied')
  }
  if (m.includes('ssh agent has no available identities')) {
    return t('terminal.agentNoIdentities')
  }
  if (m.includes('all ssh agent identities rejected')) {
    return t('terminal.agentRejected')
  }
  if (m.includes('failed to read identities from ssh agent')) {
    return t('terminal.agentReadFailed')
  }
  return msg
}
