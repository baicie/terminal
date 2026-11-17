/**
 * The AI dock's configuration strip: which profile, which action, where the text goes.
 *
 * Split out of `ai-dock-view.tsx` for the size limit. Also the place where the design's
 * "the user must see the destination" rule lives — the endpoint is printed under the
 * profile, not hidden behind a tooltip.
 */

import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { AI_ACTIONS, type AiAction } from '@/features/ai/ai-run-state'
import type { ModelProfilePublic } from '@/features/ai/model-profile'

interface AiDockConfigProps {
  profiles: ModelProfilePublic[]
  profileId: string
  onProfileChange(id: string): void
  profile: ModelProfilePublic | null
  profileIssue: string | null
  action: AiAction
  onActionChange(action: AiAction): void
}

export function AiDockConfig({
  profiles,
  profileId,
  onProfileChange,
  profile,
  profileIssue,
  action,
  onActionChange,
}: AiDockConfigProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()

  return (
    <div className="space-y-2 border-b p-3">
      <p className="text-xs text-muted-foreground">{t('ai.profile')}</p>
      {/* Buttons rather than a native select: the project forbids native form
          controls, and the list is short enough that a row of choices reads better. */}
      <div className="flex flex-wrap gap-1" role="listbox" aria-label={t('ai.profile')}>
        {profiles.length === 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('ai.noProfileHint')}</p>
            {/* A sentence telling the user where to go is not an entry point. The
                first-run path is: open the dock, find nothing, and need to land on the
                exact settings tab — so the link goes there rather than describing it.
                A button with a router navigation, not an `<a href>`: a bare href would
                do a full page load and tear down every open session. */}
            <Button size="sm" variant="outline" onClick={() => navigate('/settings')}>
              {t('ai.openSettings')}
            </Button>
          </div>
        )}
        {profiles.map(candidate => (
          <Button
            key={candidate.id}
            size="sm"
            variant={candidate.id === profileId ? 'default' : 'outline'}
            role="option"
            aria-selected={candidate.id === profileId}
            onClick={() => onProfileChange(candidate.id)}
          >
            {candidate.name}
          </Button>
        ))}
      </div>

      {profile && (
        <p className="text-xs text-muted-foreground" data-testid="ai-endpoint">
          {/* The design requires the actual destination to be visible. */}
          {profile.provider} · {profile.modelId} · {profile.endpoint}
        </p>
      )}
      {profileIssue && (
        <p className="text-xs text-destructive" data-testid="ai-profile-issue">
          {profileIssue}
        </p>
      )}

      <Separator />

      <div className="flex flex-wrap gap-1" role="group" aria-label={t('ai.action')}>
        {AI_ACTIONS.map(candidate => (
          <Button
            key={candidate}
            size="sm"
            variant={candidate === action ? 'default' : 'outline'}
            onClick={() => onActionChange(candidate)}
          >
            {t(`ai.action.${candidate}`)}
          </Button>
        ))}
      </div>
    </div>
  )
}
