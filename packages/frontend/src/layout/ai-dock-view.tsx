/**
 * The AI dock's body.
 *
 * A presentational shell over `AiRunner`: the runner owns the checks and the state,
 * this renders them. Same split as the Snippet Dock — an extension or feature that
 * owned a React component would have render access, and the runner's guarantees would
 * then depend on what the component chose to call.
 *
 * ## What the UI must show, and why each is not optional
 *
 * - **Which profile, which endpoint, which action.** The design requires the user to
 *   see where their text is going; a dock that says "AI" and sends to whatever is
 *   selected is the failure mode the endpoint rules exist to prevent.
 * - **The context preview, before sending.** The user approves text, not a request.
 * - **`N/A`-style honesty for an empty answer.** An empty completion is shown as
 *   empty, never as a spinner that resolves to nothing.
 * - **Draft risk.** A `draft-command` result carries its risk flags visibly.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { AiAction, AiRun } from '@/features/ai/ai-run-state'
import { buildContext, type ApprovedContext, type ContextKind } from '@/features/ai/context-review'
import { profileProblem, type ModelProfilePublic } from '@/features/ai/model-profile'
import type { AiRunner, StartResult } from '@/features/ai/ai-runner'
import { AiDockResult } from './ai-dock-result'
import { AiDockConfig } from './ai-dock-config'

interface AiDockProps {
  runner: AiRunner
  profiles: ModelProfilePublic[]
  /** The text the user has selected, or null. Never read implicitly. */
  selectedText: string | null
  /** The session the selection came from, for the binding check. */
  sessionId: string | null
  /** The backend session behind the selection; see `buildContext`. */
  backendSessionId?: string | null
  hostId: string | null
  onClose: () => void
  /** Called when the user asks to save a draft as a snippet. */
  onSaveSnippet?: (text: string) => void
}

/** Which context kind each action consumes. */
const ACTION_CONTEXT: Record<AiAction, ContextKind> = {
  'explain-selection': 'selection',
  'explain-error': 'error',
  'summarize-output': 'output',
  'draft-command': 'selection',
}

export function AiDock({
  runner,
  profiles,
  selectedText,
  sessionId,
  backendSessionId = null,
  hostId,
  onClose,
  onSaveSnippet,
}: AiDockProps) {
  const { t } = useTranslation()
  const [run, setRun] = useState<AiRun>(() => runner.current())
  // The runner owns the state; this only mirrors it for rendering.
  useEffect(() => runner.subscribe(setRun), [runner])
  const [profileId, setProfileId] = useState<string>(() => profiles[0]?.id ?? '')
  const [action, setAction] = useState<AiAction>('explain-selection')
  const [approved, setApproved] = useState<ApprovedContext | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const profile = useMemo(
    () => profiles.find(candidate => candidate.id === profileId) ?? null,
    [profiles, profileId],
  )

  // Build the candidate context whenever the selection or action changes. It stays
  // unapproved until the user presses the button: selecting text is not consent.
  const candidate = useMemo(() => {
    if (!selectedText) return null
    const built = buildContext({
      kind: ACTION_CONTEXT[action],
      hostId,
      sessionId,
      backendSessionId,
      text: selectedText,
    })
    return built.ok ? built.context : null
  }, [selectedText, action, hostId, sessionId, backendSessionId])

  // A new selection invalidates a previous approval — the user must see the text they
  // are about to send, and the old approval was for different text.
  useEffect(() => {
    setApproved(null)
    setRefusal(null)
    setCopied(false)
  }, [selectedText, action, profileId])

  const start = useCallback(async () => {
    if (!profile || !candidate) return
    const approvedContext: ApprovedContext = { ...candidate, approved: true }
    setApproved(approvedContext)
    const result: StartResult = await runner.start({ action, profile, context: approvedContext })
    if (!result.ok) {
      setRefusal(result.message)
      return
    }
    setRefusal(null)
  }, [action, candidate, profile, runner])

  const profileIssue = profile ? profileProblem(profile) : t('ai.noProfile')

  return (
    <div className="flex h-full flex-col" data-testid="ai-dock">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-sm font-medium">{t('ai.title')}</h2>
        <Button variant="ghost" size="sm" onClick={onClose}>
          {t('common.close')}
        </Button>
      </div>

      <AiDockConfig
        profiles={profiles}
        profileId={profileId}
        onProfileChange={setProfileId}
        profile={profile}
        profileIssue={profileIssue}
        action={action}
        onActionChange={setAction}
      />

      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-3 p-3">
          {!candidate && (
            <p className="text-sm text-muted-foreground" data-testid="ai-no-selection">
              {t('ai.selectSomething')}
            </p>
          )}

          {candidate && !approved && (
            <div className="space-y-2" data-testid="ai-context-preview">
              <p className="text-xs text-muted-foreground">
                {t('ai.contextPreview', { bytes: candidate.bytes })}
              </p>
              <pre className="max-h-40 overflow-auto rounded bg-muted p-2 text-xs">
                {candidate.preview}
              </pre>
              <Button size="sm" onClick={() => void start()} disabled={Boolean(profileIssue)}>
                {t('ai.approveAndSend')}
              </Button>
            </div>
          )}

          {refusal && (
            <p className="text-sm text-destructive" role="alert" data-testid="ai-refusal">
              {refusal}
            </p>
          )}

          {approved && (
            <AiDockResult
              runner={runner}
              run={run}
              copied={copied}
              onCopied={() => setCopied(true)}
              onSaveSnippet={onSaveSnippet}
            />
          )}
        </div>
      </ScrollArea>

      <p className="border-t px-3 py-2 text-xs text-muted-foreground">
        {/* Stated once, always visible: nothing here runs anything. */}
        {t('ai.neverRuns')}
      </p>
    </div>
  )
}
