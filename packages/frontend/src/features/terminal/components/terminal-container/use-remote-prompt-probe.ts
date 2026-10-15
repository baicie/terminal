import { useCallback, useEffect, useRef } from 'react'
import type { TerminalOutputDiagnosticEvent } from '@/hooks/terminal-session-types'
import {
  getRemotePromptProbeConfig,
  reportRemotePromptProbeObserved,
} from '@/features/terminal/services/remote-prompt-probe'
import type { ShellIntegrationEvent } from '@/features/terminal/services/terminal-shell-integration'

type TerminalInput = (data: string, wasUserInput?: boolean) => void

interface UseRemotePromptProbeOptions {
  tabId: string
  isRemote: boolean
}

export function useRemotePromptProbe({
  tabId,
  isRemote,
}: UseRemotePromptProbeOptions) {
  const inputRef = useRef<TerminalInput | undefined>(undefined)
  const sentRef = useRef(false)
  const pendingRef = useRef(false)
  const observedRef = useRef(false)
  const outputRef = useRef('')
  const promptSeenRef = useRef(false)
  const cwdMatchedRef = useRef(false)
  const exitMatchedRef = useRef(false)
  const markerSeenRef = useRef(false)
  const config = getRemotePromptProbeConfig()

  useEffect(() => {
    sentRef.current = false
    pendingRef.current = false
    observedRef.current = false
    outputRef.current = ''
    promptSeenRef.current = false
    cwdMatchedRef.current = config?.expectedCwd === undefined
    exitMatchedRef.current = config?.expectedExitCode === undefined
    markerSeenRef.current = false
  }, [config?.expectedCwd, config?.expectedExitCode, isRemote, tabId])

  const reportWhenComplete = useCallback(() => {
    if (
      observedRef.current ||
      !markerSeenRef.current ||
      (config?.expectedCwd !== undefined && !promptSeenRef.current) ||
      (config?.expectedExitCode !== undefined && !promptSeenRef.current) ||
      !cwdMatchedRef.current ||
      !exitMatchedRef.current
    ) {
      return
    }
    observedRef.current = true
    void reportRemotePromptProbeObserved().catch(error => {
      console.error('Failed to report remote prompt probe:', error)
    })
  }, [config])

  const sendPendingPrompt = useCallback(() => {
    if (
      !pendingRef.current ||
      sentRef.current ||
      !isRemote ||
      !config ||
      !inputRef.current
    ) {
      return
    }
    pendingRef.current = false
    sentRef.current = true
    inputRef.current(`${config.command}\r`, false)
  }, [config, isRemote])

  useEffect(() => {
    sendPendingPrompt()
  })

  const onShellIntegration = (event: ShellIntegrationEvent) => {
    if (!isRemote || !config) return
    if (event.kind === 'prompt-start') promptSeenRef.current = true
    if (
      event.kind === 'cwd' &&
      config.expectedCwd !== undefined &&
      event.cwd === config.expectedCwd
    ) {
      cwdMatchedRef.current = true
    }
    if (
      event.kind === 'command-finished' &&
      config.expectedExitCode !== undefined &&
      event.exitCode === config.expectedExitCode
    ) {
      exitMatchedRef.current = true
    }
    reportWhenComplete()
    if (event.kind !== 'prompt-start' || sentRef.current) return
    pendingRef.current = true
    sendPendingPrompt()
  }

  const onOutput = (event: TerminalOutputDiagnosticEvent) => {
    if (!isRemote || !config || observedRef.current) return
    const nextOutput = `${outputRef.current}${event.data}`
    const escapedMarker = config.marker.replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&',
    )
    // OSC sequences can share an output chunk with the command marker. Match
    // printable token boundaries instead of requiring a preceding newline.
    if (
      !new RegExp(
        `(?:^|[^A-Za-z0-9_])${escapedMarker}(?=$|[^A-Za-z0-9_])`,
      ).test(nextOutput)
    ) {
      outputRef.current = nextOutput.slice(-4096)
      return
    }
    outputRef.current = nextOutput.slice(-4096)
    markerSeenRef.current = true
    reportWhenComplete()
  }

  return { inputRef, onShellIntegration, onOutput }
}
