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
 * - **No host confusion.** A result whose `hostId` is not the panel's host is
 *   discarded, so a probe that finishes after the user switched tabs cannot land here.
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
}

type PanelState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'result'; result: ProbeResult }
  | { kind: 'error'; reason: string; message: string }

export function ServerInspector({ hostId, sessionId, exec, onClose }: ServerInspectorProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<PanelState>({ kind: 'idle' })
  // Bumped on every refresh and on unmount, so a probe that finishes late can tell it
  // is no longer wanted.
  const generationRef = useRef(0)

  // Unmount cancels: no probe survives the panel, which is the design's "closing the
  // dock stops everything".
  useEffect(() => {
    return () => {
      generationRef.current += 1
    }
  }, [])

  // A host change invalidates the displayed result: it describes a different machine.
  useEffect(() => {
    generationRef.current += 1
    setState({ kind: 'idle' })
  }, [hostId, sessionId])

  const refresh = useCallback(async () => {
    if (!hostId || !sessionId) return
    generationRef.current += 1
    const generation = generationRef.current
    setState({ kind: 'running' })

    const outcome: InspectorOutcome = await runInspectorProbe(exec, { hostId, sessionId })

    // The user refreshed again, switched host, or closed the panel while this ran.
    if (generation !== generationRef.current) return

    if (outcome.ok) {
      setState({ kind: 'result', result: outcome.result })
    } else {
      setState({ kind: 'error', reason: outcome.reason, message: outcome.message })
    }
  }, [exec, hostId, sessionId])

  const result = state.kind === 'result' ? state.result : null
  const stale = result ? isStale(result, Date.now()) : false

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
              <Badge variant={stale ? 'destructive' : 'secondary'} data-testid="inspector-age">
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
