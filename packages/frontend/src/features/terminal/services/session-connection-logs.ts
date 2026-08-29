import { addConnectionLog, updateConnectionLog } from '@/service/database'

type ConnectionType = 'ssh' | 'local' | 'serial'
type HostInfo = {
  id?: string
  name: string
  hostname?: string
  username?: string
}

const activeConnectionLogs = new Map<
  string,
  { logId: string; startTime: number }
>()

function normalizeErrorMessage(message: string): string {
  const normalized = message.toLowerCase()
  if (normalized.includes('no ssh agent pipe found'))
    return 'SSH agent socket not found'
  if (
    normalized.includes('ssh_auth_sock points') &&
    normalized.includes('pipe was not found')
  )
    return 'SSH agent socket path is invalid'
  if (normalized.includes('permission denied when opening ssh agent pipe'))
    return 'Permission denied when opening SSH agent socket'
  if (normalized.includes('ssh agent has no available identities'))
    return 'SSH agent has no available identities'
  if (normalized.includes('all ssh agent identities rejected'))
    return 'All SSH agent identities were rejected'
  if (normalized.includes('failed to read identities from ssh agent'))
    return 'Failed to read identities from SSH agent'
  return message
}

export async function recordConnectionSuccess(
  sessionId: string,
  hostInfo: HostInfo,
  connectionType: ConnectionType,
  defaults: { hostname: string; username: string },
): Promise<void> {
  const logId = await addConnectionLog({
    host_id: hostInfo.id || null,
    host_name: hostInfo.name,
    host_address: hostInfo.hostname || defaults.hostname,
    username: hostInfo.username || defaults.username,
    connection_type: connectionType,
    started_at: Date.now(),
    ended_at: null,
    duration_seconds: null,
    is_saved: 0,
    notes: null,
    error_message: null,
    error_raw: null,
  })
  activeConnectionLogs.set(sessionId, { logId, startTime: Date.now() })
}

export async function recordConnectionFailure(
  hostInfo: HostInfo,
  connectionType: ConnectionType,
  errorMessage: string,
): Promise<string | null> {
  try {
    return await addConnectionLog({
      host_id: hostInfo.id || null,
      host_name: hostInfo.name,
      host_address: hostInfo.hostname ?? 'unknown',
      username: hostInfo.username || null,
      connection_type: connectionType,
      started_at: Date.now(),
      ended_at: Date.now(),
      duration_seconds: 0,
      is_saved: 0,
      notes: null,
      error_message: normalizeErrorMessage(errorMessage),
      error_raw: errorMessage,
    })
  } catch (error) {
    console.error('[Session] Failed to record connection failure:', error)
    return null
  }
}

export async function finishConnectionLog(sessionId: string): Promise<void> {
  const logInfo = activeConnectionLogs.get(sessionId)
  if (!logInfo) return
  const endTime = Date.now()
  try {
    await updateConnectionLog(logInfo.logId, {
      ended_at: endTime,
      duration_seconds: Math.round((endTime - logInfo.startTime) / 1000),
    })
  } catch (error) {
    console.error('[Session] Failed to update connection log:', error)
  }
  activeConnectionLogs.delete(sessionId)
}
