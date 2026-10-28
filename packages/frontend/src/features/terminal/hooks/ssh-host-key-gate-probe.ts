import { buildSshJumpHostIpcConfig } from '@/features/terminal/services/ssh-jump-config'
import {
  probeSshHostKey,
  probeSshHostKeyViaJump,
} from '@/features/terminal/services/ssh-host-key'
import { remainingTerminalConnectionMs } from '@/features/terminal/services/terminal-connection-deadline'
import { formatIpcError } from '@/hooks/terminal-session-helpers'
import type { Host } from '@/types'
import type { TabType } from '../types'
import {
  isRetryableSshHostKeyProbeError,
  SSH_HOST_KEY_PROBE_RETRY_DELAYS_MS,
  SSH_HOST_KEY_STARTUP_DEADLINE_ERROR,
  type GateState,
  type HostKeyPins,
  type RunProbe,
} from './ssh-host-key-gate-helpers'

interface Ref<T> {
  current: T
}

export interface SshHostKeyGateProbeDependencies {
  tabType: TabType
  host?: Host
  jumpHost?: Host
  currentRouteKey: string
  routeKeyRef: Ref<string>
  operationRef: Ref<number>
  runProbeRef: Ref<RunProbe>
  readyRouteKeyRef: Ref<string | null>
  connectionDeadlineAtRef: Ref<number>
  probeRetryAttemptRef: Ref<number>
  probeRetryTimerRef: Ref<ReturnType<typeof setTimeout> | null>
  resetProbeRetry: () => void
  setState: (state: GateState) => void
}

export function runSshHostKeyGateProbe(
  role: Parameters<RunProbe>[0],
  pins: HostKeyPins,
  dependencies: SshHostKeyGateProbeDependencies,
): void {
  const {
    tabType,
    host,
    jumpHost,
    currentRouteKey,
    routeKeyRef,
    operationRef,
    runProbeRef,
    readyRouteKeyRef,
    connectionDeadlineAtRef,
    probeRetryAttemptRef,
    probeRetryTimerRef,
    resetProbeRetry,
    setState,
  } = dependencies

  if (tabType !== 'remote') {
    readyRouteKeyRef.current = currentRouteKey
    setState({ status: 'ready' })
    return
  }
  if (!host) {
    setState({
      status: 'error',
      role: 'host',
      error: 'Host info required for remote connection',
    })
    return
  }
  if (host.jumpHostId && (!jumpHost || jumpHost.id !== host.jumpHostId)) {
    setState({
      status: 'error',
      role: 'jump',
      error: 'Configured jump host could not be resolved',
    })
    return
  }

  const operation = ++operationRef.current
  const operationRouteKey = currentRouteKey
  setState({ status: 'checking', role, ...pins })
  const timeoutMs = remainingTerminalConnectionMs(
    connectionDeadlineAtRef.current,
  )
  if (timeoutMs === undefined || timeoutMs <= 0) {
    resetProbeRetry()
    setState({
      status: 'error',
      role,
      error: SSH_HOST_KEY_STARTUP_DEADLINE_ERROR,
      ...pins,
    })
    return
  }
  const probeOptions = { timeoutMs }
  const probe =
    role === 'jump' && jumpHost
      ? probeSshHostKey(jumpHost.hostname, jumpHost.port, probeOptions)
      : role === 'target' && jumpHost
        ? probeSshHostKeyViaJump(
            host.hostname,
            host.port,
            buildSshJumpHostIpcConfig(host, jumpHost, pins.expectedJumpHostKey),
            probeOptions,
          )
        : probeSshHostKey(host.hostname, host.port, probeOptions)

  void probe
    .then(result => {
      if (
        operationRef.current !== operation ||
        routeKeyRef.current !== operationRouteKey
      ) {
        return
      }
      if (
        (remainingTerminalConnectionMs(connectionDeadlineAtRef.current) ?? 0) <=
        0
      ) {
        resetProbeRetry()
        setState({
          status: 'error',
          role,
          error: SSH_HOST_KEY_STARTUP_DEADLINE_ERROR,
          ...pins,
        })
        return
      }
      if (result.status === 'trusted') {
        resetProbeRetry()
        if (role === 'jump') runProbeRef.current('target', pins)
        else {
          readyRouteKeyRef.current = operationRouteKey
          setState({ status: 'ready', ...pins })
        }
        return
      }
      resetProbeRetry()
      setState({
        status: result.status === 'changed' ? 'blocked' : 'prompt',
        role,
        prompt: result,
        saving: false,
        error: null,
        ...pins,
      })
    })
    .catch(error => {
      if (
        operationRef.current !== operation ||
        routeKeyRef.current !== operationRouteKey
      ) {
        return
      }
      const nextAttempt = probeRetryAttemptRef.current + 1
      if (
        isRetryableSshHostKeyProbeError(error) &&
        nextAttempt <= SSH_HOST_KEY_PROBE_RETRY_DELAYS_MS.length
      ) {
        const delay = SSH_HOST_KEY_PROBE_RETRY_DELAYS_MS[nextAttempt - 1]
        const remainingMs = remainingTerminalConnectionMs(
          connectionDeadlineAtRef.current,
        )
        if (remainingMs === undefined || remainingMs <= delay) {
          resetProbeRetry()
          setState({
            status: 'error',
            role,
            error: SSH_HOST_KEY_STARTUP_DEADLINE_ERROR,
            ...pins,
          })
          return
        }
        probeRetryAttemptRef.current = nextAttempt
        probeRetryTimerRef.current = setTimeout(() => {
          probeRetryTimerRef.current = null
          if (
            operationRef.current !== operation ||
            routeKeyRef.current !== operationRouteKey
          ) {
            return
          }
          runProbeRef.current(role, pins)
        }, delay)
        setState({
          status: 'error',
          role,
          error: formatIpcError(error),
          ...pins,
        })
        return
      }
      resetProbeRetry()
      setState({
        status: 'error',
        role,
        error: formatIpcError(error),
        ...pins,
      })
    })
}
