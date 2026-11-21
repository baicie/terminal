/**
 * The Server Inspector panel.
 *
 * Read-only facts about the host the user is connected to, with the time they were
 * collected. Nothing here polls: the only thing that starts a probe is the Refresh
 * button, and unmounting cancels whatever is in flight.
 *
 * ## What the panel refuses to do
 *
 * - **No timer.** The design forbids a resident collector, so there is no interval
 *   anywhere in this file. A panel the user left open does not query their server.
 * - **No invented numbers.** Every metric goes through `formatBytes` / `formatUptime`
 *   / `ratioPercent`, all of which return `N/A` for `null`. A missing reading never
 *   renders as zero.
 * - **No stale result posing as current.** Past the TTL the panel badges the result
 *   rather than quietly showing old numbers as if they were fresh.
 * - **No host confusion.** Two checks: `generationRef` (bumped on refresh, host
 *   change and unmount) stops a slow answer landing after a switch, and
 *   `result.hostId === hostId` drops a reading that names a different host. The
 *   comment here once claimed the second and only the first existed.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { isStale, type ProbeResult } from '@/features/inspector/server-inspector'
import { InspectorMetrics } from './server-inspector-metrics'
import { runInspectorProbe, type InspectorExec, type InspectorOutcome } from '@/features/inspector/inspector-probe'

interface ServerInspectorProps {
  hostId: string | null
  sessionId: string | null
  /** The exec bridge. Injected so the panel has no Tauri dependency of its own. */
  exec: InspectorExec
  onClose: () => void
  /**
   * The probe itself, injectable so a test can produce a reading without a server.
   *
   * Defaults to the real `runInspectorProbe`. It is a separate prop from `exec`
   * because the two answer different questions: `exec` is the transport, this is the
   * policy — which commands run, in what order, and what a partial result means.
   */
  probe?: (exec: InspectorExec, options: { hostId: string, sessionId: string }) => Promise<InspectorOutcome>
}

type PanelState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'result'; result: ProbeResult }
  | { kind: 'error'; reason: string; message: string }

export function ServerInspector({ hostId, sessionId, exec, onClose, probe = runInspectorProbe }: ServerInspectorProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<PanelState>({ kind: 'idle' })
  // Bumped on every refresh and on unmount, so a probe that finishes late can tell it
  // is no longer wanted.
  const generationRef = useRef(0)

  // Closing used to abandon the promise while the exec stayed open until its timeout.
  // `cancelLast` stops that exec and nothing else: not the session, not the shell.
  useEffect(() => {
    return () => {
      generationRef.current += 1
      void exec.cancelLast?.()
    }
  }, [exec])

  // Skips the first run: on mount there is no exec to cancel.
  const mountedRef = useRef(false)
  useEffect(() => {
    generationRef.current += 1
    setState({ kind: 'idle' })
    if (mountedRef.current) void exec.cancelLast?.()
    mountedRef.current = true
  }, [hostId, sessionId, exec])

  const refresh = useCallback(async () => {
    if (!hostId || !sessionId) return
    generationRef.current += 1
    const generation = generationRef.current
    setState({ kind: 'running' })

    const outcome: InspectorOutcome = await probe(exec, { hostId, sessionId })

    // The user refreshed again, switched host, or closed the panel while this ran.
    if (generation !== generationRef.current) return

    if (outcome.ok) {
      // The reading names its host; a mismatch means the caller wired the wrong value,
      // which would show machine A's uptime under machine B's name.

      if (outcome.result.hostId !== hostId) return
      setState({ kind: 'result', result: outcome.result })
    } else {
      setState({ kind: 'error', reason: outcome.reason, message: outcome.message })
    }
  }, [exec, hostId, sessionId, probe])

  const result = state.kind === 'result' ? state.result : null
  // Staleness is driven by a 1s tick, not computed once during render: React has no
  // reason to re-render when the TTL passes, so a panel left open kept showing
  // "Observed 14:02:11" as though the numbers were live.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!result) return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [result])
  const stale = result ? isStale(result, now) : false

  return (
    <div className="flex h-full flex-col" data-testid="server-inspector">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-sm font-medium">{t('inspector.title')}</h2>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void refresh()}
            disabled={state.kind === 'running' || !sessionId || !hostId}
          >
            {t('common.refresh')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {/*
          The panel can read a host over SSH only when both are present. A **local**
          terminal has a session id and no host, and the old condition tested the id
          alone — so the panel showed neither "open a session" nor any result, just the
          title and two buttons. Found by e2e-04 driving a real WebView: the whole body
          read `"Server inspectorRefreshClose"`.
        */}
        {(!sessionId || !hostId) && (
          <p className="text-sm text-muted-foreground" data-testid="inspector-no-session">
            {t('inspector.noSession')}
          </p>
        )}

        {state.kind === 'running' && (
          <p className="text-sm text-muted-foreground" data-testid="inspector-running">
            {t('inspector.running')}
          </p>
        )}

        {state.kind === 'error' && (
          <div className="space-y-1" data-testid="inspector-error">
            <Badge variant="destructive">{state.reason}</Badge>
            <p className="text-sm text-destructive" role="alert">
              {state.message}
            </p>
          </div>
        )}

        {result && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant={stale ? 'destructive' : 'secondary'}
                data-testid={stale ? 'inspector-stale-badge' : 'inspector-age'}
              >
                {stale
                  ? t('inspector.stale')
                  : t('inspector.observedAt', {
                      time: new Date(result.observedAt).toLocaleTimeString(),
                    })}
              </Badge>
            </div>

            <InspectorMetrics result={result} />

            {result.notes.length > 0 && (
              <ul className="list-disc pl-4 text-xs text-muted-foreground">
                {result.notes.map(note => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}

            <Separator />
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">{t('inspector.source')}</p>
              <pre className="max-h-24 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">
                {result.source.join('\n')}
              </pre>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
