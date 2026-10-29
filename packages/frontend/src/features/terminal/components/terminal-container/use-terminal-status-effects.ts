import { useEffect, useRef } from 'react'
import { toast } from 'sonner'
import type { Host, Tab } from '@/types'
import type { UseTerminalResult } from '@/hooks/terminal-session-types'
import { notify } from '@/service/notifications'

interface TerminalStatusEffectOptions {
  status: UseTerminalResult['status']
  error: string | null
  readableError: string | null
  errorTitle: string
  tab: Tab | undefined
  host: Host | undefined
}

export function useTerminalStatusEffects(options: TerminalStatusEffectOptions) {
  useEffect(() => {
    if (options.error) {
      toast.error(
        options.errorTitle + ': ' + (options.readableError ?? options.error),
      )
    }
  }, [options.error, options.errorTitle, options.readableError])

  const previousStatusRef = useRef(options.status)
  useEffect(() => {
    const previousStatus = previousStatusRef.current
    previousStatusRef.current = options.status
    if (previousStatus !== 'connected') return
    if (options.status !== 'disconnected' && options.status !== 'error') return
    if (!options.tab) return

    const target =
      options.tab.type === 'serial'
        ? (options.tab.serialConfig?.port ?? options.tab.label)
        : options.host
          ? options.host.username + '@' + options.host.hostname
          : options.tab.label
    void notify({
      title:
        options.status === 'error'
          ? 'Terminal error · ' + target
          : 'Disconnected · ' + target,
      body: options.readableError ?? undefined,
      type: options.status === 'error' ? 'error' : 'warning',
    })
  }, [
    options.status,
    options.error,
    options.tab,
    options.host,
    options.readableError,
  ])
}
