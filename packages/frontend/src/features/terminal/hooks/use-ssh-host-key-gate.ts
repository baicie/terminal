import { useCallback, useEffect, useRef, useState } from 'react'
import { buildSshJumpHostIpcConfig } from '@/features/terminal/services/ssh-jump-config'
import {
  learnSshHostKey,
  probeSshHostKey,
  probeSshHostKeyViaJump,
  type SshHostKeyProbeResult,
} from '@/features/terminal/services/ssh-host-key'
import { formatIpcError } from '@/hooks/terminal-session-helpers'
import type { Host } from '@/types'
import type { TabType } from '../types'

export type SshHostKeyGateStatus =
  | 'checking'
  | 'ready'
  | 'prompt'
  | 'blocked'
  | 'error'

export type SshHostKeyRole = 'host' | 'jump' | 'target'

interface HostKeyPins {
  expectedHostKey?: string
  expectedJumpHostKey?: string
}

type GateState =
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

interface UseSshHostKeyGateOptions {
  tabType: TabType
  host?: Host
  jumpHost?: Host
}

type RunProbe = (role: SshHostKeyRole, pins: HostKeyPins) => void

function getInitialState(options: UseSshHostKeyGateOptions): GateState {
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

function routeKey(options: UseSshHostKeyGateOptions): string {
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

function pinsFrom(state: GateState): HostKeyPins {
  return {
    expectedHostKey: state.expectedHostKey,
    expectedJumpHostKey: state.expectedJumpHostKey,
  }
}

export function useSshHostKeyGate(options: UseSshHostKeyGateOptions) {
  const [state, setState] = useState<GateState>(() => getInitialState(options))
  const operationRef = useRef(0)
  const runProbeRef = useRef<RunProbe>(() => {})
  const currentRouteKey = routeKey(options)
  const routeKeyRef = useRef(currentRouteKey)
  routeKeyRef.current = currentRouteKey
  const { host, jumpHost, tabType } = options
  const invalidateOperation = useCallback(() => {
    ++operationRef.current
  }, [])

  const runProbe = useCallback<RunProbe>(
    (role, pins) => {
      if (tabType !== 'remote') {
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
      if (
        host.jumpHostId &&
        (!jumpHost || jumpHost.id !== host.jumpHostId)
      ) {
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
      const probe =
        role === 'jump' && jumpHost
          ? probeSshHostKey(jumpHost.hostname, jumpHost.port)
          : role === 'target' && jumpHost
            ? probeSshHostKeyViaJump(
                host.hostname,
                host.port,
                buildSshJumpHostIpcConfig(
                  host,
                  jumpHost,
                  pins.expectedJumpHostKey,
                ),
              )
            : probeSshHostKey(host.hostname, host.port)

      void probe
        .then(result => {
          if (
            operationRef.current !== operation ||
            routeKeyRef.current !== operationRouteKey
          ) {
            return
          }
          if (result.status === 'trusted') {
            if (role === 'jump') runProbeRef.current('target', pins)
            else setState({ status: 'ready', ...pins })
            return
          }
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
            operationRef.current === operation &&
            routeKeyRef.current === operationRouteKey
          ) {
            setState({
              status: 'error',
              role,
              error: formatIpcError(error),
              ...pins,
            })
          }
        })
    },
    [currentRouteKey, host, jumpHost, tabType],
  )
  runProbeRef.current = runProbe

  useEffect(() => {
    if (tabType !== 'remote') {
      invalidateOperation()
      setState({ status: 'ready' })
      return
    }
    runProbe(host?.jumpHostId ? 'jump' : 'host', {})
    return () => {
      invalidateOperation()
    }
  }, [currentRouteKey, host?.jumpHostId, invalidateOperation, runProbe, tabType])

  const trustOnce = useCallback(() => {
    if (state.status !== 'prompt' || state.prompt.status !== 'unknown') return
    ++operationRef.current
    const pins = pinsFrom(state)
    if (state.role === 'jump') {
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
  }, [runProbe, state])

  const trustAndSave = useCallback(async () => {
    if (state.status !== 'prompt' || state.prompt.status !== 'unknown') return
    const prompt = state.prompt
    const role = state.role
    const pins = pinsFrom(state)
    const operation = ++operationRef.current
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
      if (role === 'jump') runProbe('target', pins)
      else setState({ status: 'ready', ...pins })
    } catch (error) {
      if (
        operationRef.current === operation &&
        routeKeyRef.current === operationRouteKey
      ) {
        setState({ ...state, saving: false, error: formatIpcError(error) })
      }
    }
  }, [currentRouteKey, runProbe, state])

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
    runProbe(state.role, pinsFrom(state))
  }, [runProbe, state])

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
    enabled: state.status === 'ready',
    expectedHostKey:
      state.status === 'ready' ? state.expectedHostKey : undefined,
    expectedJumpHostKey:
      state.status === 'ready' ? state.expectedJumpHostKey : undefined,
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
