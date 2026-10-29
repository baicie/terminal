import { formatIpcError } from '@/hooks/terminal-session-helpers'
import type { Host } from '@/types'
import type { SshHostKeyProbeResult } from '@/features/terminal/services/ssh-host-key'
import type { TabType } from '../types'

export type SshHostKeyRole = 'host' | 'jump' | 'target'

export interface HostKeyPins {
  expectedHostKey?: string
  expectedJumpHostKey?: string
}

export type GateState =
  | ({ status: 'checking'; role: SshHostKeyRole } & HostKeyPins)
  | ({ status: 'ready' } & HostKeyPins)
  | ({
      status: 'prompt' | 'blocked'
      role: SshHostKeyRole
      prompt: SshHostKeyProbeResult
      saving: boolean
      error: string | null
    } & HostKeyPins)
  | ({
      status: 'error'
      role: SshHostKeyRole
      error: string
    } & HostKeyPins)

export interface UseSshHostKeyGateOptions {
  tabType: TabType
  host?: Host
  jumpHost?: Host
}

export const SSH_HOST_KEY_STARTUP_DEADLINE_ERROR =
  'SSH startup deadline expired before the terminal became ready'

export type RunProbe = (role: SshHostKeyRole, pins: HostKeyPins) => void

export const SSH_HOST_KEY_PROBE_RETRY_DELAYS_MS = [250, 1_000, 3_000] as const

const TRANSIENT_PROBE_MESSAGES = [
  'timed out',
  'timeout',
  'connection reset',
  'connection refused',
  'connection aborted',
  'connection closed',
  'forcibly closed by the remote host',
  'actively refused',
  'target machine actively refused',
  'semaphore timeout period has expired',
  'no connection could be made',
  'no such host is known',
  'host could not be resolved',
  'network offline',
  'network unavailable',
  'network is unreachable',
  'no route to host',
  'host unreachable',
  'broken pipe',
  'transport closed',
  'failed to resolve',
  'temporary failure in name resolution',
  'name or service not known',
  'nodename nor servname',
  'no such host',
]

const WINDOWS_TRANSIENT_ERROR_CODE =
  /\b(?:os error|winsock(?: error)?|wsa error|error code)\s*:?\s*(?:10054|10060|10061|11001|121)\b/

function errorRecord(error: unknown): Record<string, unknown> | undefined {
  return error && typeof error === 'object'
    ? (error as Record<string, unknown>)
    : undefined
}

export function isRetryableSshHostKeyProbeError(error: unknown): boolean {
  const record = errorRecord(error)
  const type = record?.type ?? record?.kind
  const message = formatIpcError(error).toLowerCase()
  const transientMessage =
    TRANSIENT_PROBE_MESSAGES.some(item => message.includes(item)) ||
    WINDOWS_TRANSIENT_ERROR_CODE.test(message)
  const permanentAuthenticationMessage = [
    'credentials rejected',
    'permission denied',
    'all methods rejected',
  ].some(item => message.includes(item))

  if (
    type === 'host_key_changed' ||
    type === 'invalid_input' ||
    type === 'key_parse_failed'
  ) {
    return false
  }
  if (type === 'authentication_failed') {
    return transientMessage && !permanentAuthenticationMessage
  }
  if (type === 'known_hosts_failed') {
    return (
      message.includes('timed out') ||
      message.includes('timeout') ||
      WINDOWS_TRANSIENT_ERROR_CODE.test(message)
    )
  }
  if (type === 'connection_failed') {
    return transientMessage && !message.includes('did not present a host key')
  }
  return transientMessage
}

export function getInitialState(options: UseSshHostKeyGateOptions): GateState {
  if (options.tabType !== 'remote') return { status: 'ready' }
  if (!options.host) {
    return {
      status: 'error',
      role: 'host',
      error: 'Host info required for remote connection',
    }
  }
  if (
    options.host.jumpHostId &&
    (!options.jumpHost || options.jumpHost.id !== options.host.jumpHostId)
  ) {
    return {
      status: 'error',
      role: 'jump',
      error: 'Configured jump host could not be resolved',
    }
  }
  return {
    status: 'checking',
    role: options.host.jumpHostId ? 'jump' : 'host',
  }
}

export function routeKey(options: UseSshHostKeyGateOptions): string {
  const { host, jumpHost, tabType } = options
  return [
    tabType,
    host?.id ?? '',
    host?.updatedAt ?? '',
    host?.hostname ?? '',
    host?.port ?? '',
    host?.jumpHostId ?? '',
    host?.jumpHostAuthType ?? '',
    jumpHost?.id ?? '',
    jumpHost?.updatedAt ?? '',
    jumpHost?.hostname ?? '',
    jumpHost?.port ?? '',
  ].join(':')
}

export function pinsFrom(state: GateState): HostKeyPins {
  return {
    expectedHostKey: state.expectedHostKey,
    expectedJumpHostKey: state.expectedJumpHostKey,
  }
}
