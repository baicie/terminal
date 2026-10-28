import { useCallback, useEffect, useRef, useState } from 'react'
import { learnSshHostKey } from '@/features/terminal/services/ssh-host-key'
import { createTerminalConnectionDeadline } from '@/features/terminal/services/terminal-connection-deadline'
import { formatIpcError } from '@/hooks/terminal-session-helpers'
import { runSshHostKeyGateProbe } from './ssh-host-key-gate-probe'
import {
  getInitialState,
  pinsFrom,
  routeKey,
  type GateState,
  type RunProbe,
  type UseSshHostKeyGateOptions,
} from './ssh-host-key-gate-helpers'

export type SshHostKeyGateStatus = GateState['status']
export type { SshHostKeyRole } from './ssh-host-key-gate-helpers'
export {
  isRetryableSshHostKeyProbeError,
  SSH_HOST_KEY_PROBE_RETRY_DELAYS_MS,
} from './ssh-host-key-gate-helpers'

export function useSshHostKeyGate(options: UseSshHostKeyGateOptions) {
  const [state, setState] = useState<GateState>(() => getInitialState(options))
  const operationRef = useRef(0)
  const runProbeRef = useRef<RunProbe>(() => {})
  const currentRouteKey = routeKey(options)
  const routeKeyRef = useRef(currentRouteKey)
  routeKeyRef.current = currentRouteKey
  const { host, jumpHost, tabType } = options
  const readyRouteKeyRef = useRef(tabType === 'remote' ? null : currentRouteKey)
  const deadlineRouteKeyRef = useRef(currentRouteKey)
  const connectionDeadlineAtRef = useRef(createTerminalConnectionDeadline())
  const probeRetryAttemptRef = useRef(0)
  const probeRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const invalidateOperation = useCallback(() => {
    ++operationRef.current
  }, [])
  const resetProbeRetry = useCallback(() => {
    if (probeRetryTimerRef.current !== null) {
      clearTimeout(probeRetryTimerRef.current)
      probeRetryTimerRef.current = null
    }
    probeRetryAttemptRef.current = 0
  }, [])

  const runProbe = useCallback<RunProbe>(
    (role, pins) =>
      runSshHostKeyGateProbe(role, pins, {
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
      }),
    [currentRouteKey, host, jumpHost, resetProbeRetry, tabType],
  )
  runProbeRef.current = runProbe

  useEffect(() => {
    resetProbeRetry()
    if (deadlineRouteKeyRef.current !== currentRouteKey) {
      deadlineRouteKeyRef.current = currentRouteKey
      connectionDeadlineAtRef.current = createTerminalConnectionDeadline()
    }
    if (tabType !== 'remote') {
      invalidateOperation()
      readyRouteKeyRef.current = currentRouteKey
      setState({ status: 'ready' })
      return
    }
    runProbe(host?.jumpHostId ? 'jump' : 'host', {})
    return () => {
      invalidateOperation()
      resetProbeRetry()
    }
  }, [
    currentRouteKey,
    host?.jumpHostId,
    invalidateOperation,
    resetProbeRetry,
    runProbe,
    tabType,
  ])

  const trustOnce = useCallback(() => {
    if (state.status !== 'prompt' || state.prompt.status !== 'unknown') return
    ++operationRef.current
    connectionDeadlineAtRef.current = createTerminalConnectionDeadline()
    const pins = pinsFrom(state)
    if (state.role === 'jump') {
      resetProbeRetry()
      runProbe('target', {
        ...pins,
        expectedJumpHostKey: state.prompt.publicKey,
      })
      return
    }
    setState({
      status: 'ready',
      ...pins,
      expectedHostKey: state.prompt.publicKey,
    })
    readyRouteKeyRef.current = currentRouteKey
  }, [currentRouteKey, resetProbeRetry, runProbe, state])

  const trustAndSave = useCallback(async () => {
    if (state.status !== 'prompt' || state.prompt.status !== 'unknown') return
    const prompt = state.prompt
    const role = state.role
    const pins = pinsFrom(state)
    const operation = ++operationRef.current
    connectionDeadlineAtRef.current = createTerminalConnectionDeadline()
    const operationRouteKey = currentRouteKey
    setState({ ...state, saving: true, error: null })
    try {
      await learnSshHostKey(prompt.host, prompt.port, prompt.publicKey)
      if (
        operationRef.current !== operation ||
        routeKeyRef.current !== operationRouteKey
      ) {
        return
      }
      if (role === 'jump') {
        resetProbeRetry()
        runProbe('target', pins)
      } else {
        readyRouteKeyRef.current = operationRouteKey
        setState({ status: 'ready', ...pins })
      }
    } catch (error) {
      if (
        operationRef.current === operation &&
        routeKeyRef.current === operationRouteKey
      ) {
        setState({ ...state, saving: false, error: formatIpcError(error) })
      }
    }
  }, [currentRouteKey, resetProbeRetry, runProbe, state])

  const cancel = useCallback(() => {
    ++operationRef.current
    const role = state.status === 'ready' ? 'host' : state.role
    setState({
      status: 'error',
      role,
      error: 'SSH host key was not trusted',
      ...pinsFrom(state),
    })
  }, [state])

  const retry = useCallback(() => {
    if (state.status === 'ready' || state.status === 'checking') return
    resetProbeRetry()
    connectionDeadlineAtRef.current = createTerminalConnectionDeadline()
    runProbe(state.role, pinsFrom(state))
  }, [resetProbeRetry, runProbe, state])

  const prompt =
    state.status === 'prompt' || state.status === 'blocked'
      ? state.prompt
      : null
  const error =
    state.status === 'error' ||
    state.status === 'prompt' ||
    state.status === 'blocked'
      ? state.error
      : null

  return {
    status: state.status,
    role: state.status === 'ready' ? null : state.role,
    enabled:
      state.status === 'ready' &&
      (tabType !== 'remote' || readyRouteKeyRef.current === currentRouteKey),
    expectedHostKey:
      state.status === 'ready' ? state.expectedHostKey : undefined,
    expectedJumpHostKey:
      state.status === 'ready' ? state.expectedJumpHostKey : undefined,
    connectionDeadlineAt:
      state.status === 'ready' && tabType === 'remote'
        ? connectionDeadlineAtRef.current
        : undefined,
    prompt,
    saving:
      state.status === 'prompt' || state.status === 'blocked'
        ? state.saving
        : false,
    error,
    trustOnce,
    trustAndSave,
    cancel,
    retry,
  }
}
