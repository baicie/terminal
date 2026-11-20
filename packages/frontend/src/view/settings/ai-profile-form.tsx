/**
 * The model-profile form fields.
 *
 * Split out of `ai-profile-editor.tsx` for the size limit, along a seam that is
 * already there: the editor decides *which* profile is being edited and performs the
 * write; this renders the fields and reports changes. It holds no state of its own,
 * which is what keeps "a new profile clears the plaintext confirmation" a rule with
 * one owner.
 */

import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  AI_PROVIDERS,
  PROFILE_LIMITS,
  type AiProvider,
  type ModelProfilePublic,
} from '@/features/ai/model-profile'
import { hasProfileSecret } from '@/service/database/ai-profiles'

interface AiProfileFormProps {
  /** True when the typed endpoint is plain HTTP to a remote host. */
  needsPlaintextWarning: boolean
  draft: ModelProfilePublic
  apiKey: string
  error: string | null
  busy: boolean
  onChange(partial: Partial<ModelProfilePublic>): void
  onApiKeyChange(value: string): void
  onSave(): void
  onCancel(): void
}

export function AiProfileForm({
  needsPlaintextWarning,
  draft,
  apiKey,
  error,
  busy,
  onChange,
  onApiKeyChange,
  onSave,
  onCancel,
}: AiProfileFormProps) {
  const { t } = useTranslation()

  return (
    <div className="space-y-3 rounded border p-3">
      <div className="space-y-1">
        <Label htmlFor="ai-profile-name">{t('settings.ai.name')}</Label>
        <Input
          id="ai-profile-name"
          value={draft.name}
          onChange={event => onChange({ name: event.target.value })}
        />
      </div>

      <div className="space-y-1">
        <p className="text-sm font-medium">{t('settings.ai.provider')}</p>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('settings.ai.provider')}>
          {AI_PROVIDERS.map((provider: AiProvider) => (
            <Button
              key={provider}
              size="sm"
              variant={draft.provider === provider ? 'default' : 'outline'}
              onClick={() => onChange({ provider })}
            >
              {provider}
            </Button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="ai-profile-endpoint">{t('settings.ai.endpoint')}</Label>
        <Input
          id="ai-profile-endpoint"
          value={draft.endpoint}
          placeholder="https://api.example.com/v1"
          onChange={event => onChange({ endpoint: event.target.value })}
        />
      </div>

      {/* Plain HTTP to a remote host is refused outright, so there is nothing to
          confirm: a switch here saved a profile that could never send a request. */}
      {needsPlaintextWarning && (
        <p className="text-xs text-destructive" role="alert" data-testid="ai-plaintext-warning">
          {t('settings.ai.plaintextRefused')}
        </p>
      )}

      <div className="space-y-1">
        <Label htmlFor="ai-profile-model">{t('settings.ai.modelId')}</Label>
        <Input
          id="ai-profile-model"
          value={draft.modelId}
          placeholder="gpt-4o-mini"
          onChange={event => onChange({ modelId: event.target.value })}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="ai-profile-key">{t('settings.ai.apiKey')}</Label>
        <Input
          id="ai-profile-key"
          type="password"
          autoComplete="off"
          value={apiKey}
          placeholder={
            hasProfileSecret(draft) ? t('settings.ai.keyKeep') : t('settings.ai.keyOptional')
          }
          onChange={event => onApiKeyChange(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">{t('settings.ai.keyHint')}</p>
      </div>

      <Separator />

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="ai-profile-max-tokens">{t('settings.ai.maxTokens')}</Label>
          <Input
            id="ai-profile-max-tokens"
            type="number"
            min={PROFILE_LIMITS.maxOutputTokens.min}
            max={PROFILE_LIMITS.maxOutputTokens.max}
            value={draft.maxOutputTokens}
            onChange={event => onChange({ maxOutputTokens: Number(event.target.value) })}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ai-profile-timeout">{t('settings.ai.timeout')}</Label>
          <Input
            id="ai-profile-timeout"
            type="number"
            min={PROFILE_LIMITS.timeoutMs.min}
            max={PROFILE_LIMITS.timeoutMs.max}
            value={draft.timeoutMs}
            onChange={event => onChange({ timeoutMs: Number(event.target.value) })}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          id="ai-profile-streaming"
          checked={draft.streaming}
          onCheckedChange={streaming => onChange({ streaming })}
        />
        <Label htmlFor="ai-profile-streaming">{t('settings.ai.streaming')}</Label>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={onSave} disabled={busy}>
          {t('common.save')}
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
