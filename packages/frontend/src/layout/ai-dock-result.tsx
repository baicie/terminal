/**
 * The AI dock's result area.
 *
 * Split out of `ai-dock-view.tsx` for the size limit, along a seam that is real: the
 * upper half decides *what to send* (profile, action, context preview), this half
 * renders *what came back*. Keeping them apart means a change to how an answer is
 * displayed cannot accidentally change the approval flow.
 */

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useTranslation } from 'react-i18next'
import { isRunning, type AiRun } from '@/features/ai/ai-run-state'
import { draftRisk } from '@/features/ai/ai-prompt'
import type { AiRunner } from '@/features/ai/ai-runner'

interface AiDockResultProps {
  runner: AiRunner
  run: AiRun
  copied: boolean
  onCopied(): void
  onSaveSnippet?: (text: string) => void
}

export function AiDockResult({ runner, run, copied, onCopied, onSaveSnippet }: AiDockResultProps) {
  const { t } = useTranslation()
  const hasText = run.text.length > 0
  const risk = run.action === 'draft-command' && hasText ? draftRisk(run.text) : null

  return (
    <>
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{run.status}</Badge>
        {run.stale && (
          <Badge variant="destructive" data-testid="ai-stale">
            {t('ai.staleFromAnother')}
          </Badge>
        )}
        {isRunning(run) && (
          <Button size="sm" variant="outline" onClick={() => runner.cancel()}>
            {t('ai.cancel')}
          </Button>
        )}
      </div>

      {run.failure && (
        <p className="text-sm text-destructive" role="alert">
          {run.failure.message}
        </p>
      )}

      {/* An empty answer is shown as empty, never as a spinner that resolves to
          nothing. */}
      {run.status === 'completed' && !hasText && (
        <p className="text-sm text-muted-foreground">{t('ai.emptyAnswer')}</p>
      )}

      {hasText && (
        <>
          <pre
            className="max-h-72 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap"
            data-testid="ai-answer"
          >
            {run.text}
          </pre>
          {risk?.risky && (
            <p className="text-xs text-destructive" data-testid="ai-risk">
              {t('ai.draftRisk', { reasons: risk.reasons.join(', ') })}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(run.text).then(onCopied)
              }}
            >
              {copied ? t('ai.copied') : t('ai.copy')}
            </Button>
            {onSaveSnippet && run.action === 'draft-command' && (
              <Button size="sm" variant="outline" onClick={() => onSaveSnippet(run.text)}>
                {t('ai.saveSnippet')}
              </Button>
            )}
          </div>
        </>
      )}
    </>
  )
}
