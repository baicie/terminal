/**
 * Adding and editing a model profile.
 *
 * Without this the AI dock can only ever show "add a profile in Settings" — the dock
 * shipped reachable and unusable, which is the same defect class as the snippet dock
 * before its toggle.
 *
 * ## What the form refuses to do
 *
 * It never sends a plaintext remote endpoint without the user having confirmed it in
 * *this* form. `validateProfile` takes `allowPlaintextRemote` as an argument rather
 * than reading a stored flag, so the confirmation cannot be inherited from a profile
 * saved earlier under different intent.
 *
 * The API key is a separate, optional field: a local endpoint needs none, and a blank
 * key means "keep what is stored" rather than "delete it".
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  checkEndpoint,
  validateProfile,
  type ModelProfilePublic,
} from '@/features/ai/model-profile'
import {
  deleteModelProfile,
  hasProfileSecret,
  setProfileSecret,
  upsertModelProfile,
} from '@/service/database/ai-profiles'
import { AiProfileForm } from './ai-profile-form'

interface ModelProfileEditorProps {
  profiles: ModelProfilePublic[]
  onChanged(): Promise<void> | void
}

/** A blank profile, with defaults a new user can actually reach a model with. */
function blankProfile(): ModelProfilePublic {
  const now = Date.now()
  return {
    id: `profile-${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: '',
    provider: 'openai-compatible',
    endpoint: '',
    modelId: '',
    temperature: null,
    maxOutputTokens: 1024,
    timeoutMs: 30_000,
    streaming: true,
    secretRef: null,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }
}

export function ModelProfileEditor({ profiles, onChanged }: ModelProfileEditorProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState<ModelProfilePublic | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [plaintextConfirmed, setPlaintextConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // A new or different profile invalidates the previous plaintext confirmation: it was
  // given for a different endpoint.
  useEffect(() => {
    setPlaintextConfirmed(false)
    setApiKey('')
    setError(null)
  }, [draft?.id])

  const update = (partial: Partial<ModelProfilePublic>) => {
    setDraft(current => (current ? { ...current, ...partial } : current))
    setError(null)
  }

  const save = async () => {
    if (!draft || busy) return
    const problem = validateProfile(draft, { allowPlaintextRemote: plaintextConfirmed })
    if (problem) {
      setError(problem.reason)
      return
    }
    setBusy(true)
    try {
      await upsertModelProfile(draft, { preserveSecretRef: true })
      // Only write a key when one was typed: a blank field means "keep the stored
      // one", not "remove it".
      if (apiKey.trim()) await setProfileSecret(draft.id, apiKey.trim())
      setApiKey('')
      setDraft(null)
      await onChanged()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    setBusy(true)
    try {
      await deleteModelProfile(id)
      if (draft?.id === id) setDraft(null)
      await onChanged()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const endpointVerdict = draft ? checkEndpoint(draft.endpoint, plaintextConfirmed) : null
  const needsPlaintextConfirmation =
    endpointVerdict !== null && !endpointVerdict.ok && endpointVerdict.reason === 'plaintext-remote'

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">{t('settings.ai.description')}</p>

      <ul className="space-y-2">
        {profiles.map(candidate => (
          <li
            key={candidate.id}
            className="flex items-center justify-between gap-3 rounded border p-2"
          >
            <div className="min-w-0">
              <p className="truncate text-sm">{candidate.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {candidate.modelId} · {candidate.endpoint}
              </p>
              <p className="text-xs text-muted-foreground">
                {hasProfileSecret(candidate) ? t('settings.ai.keyStored') : t('settings.ai.noKey')}
              </p>
            </div>
            <div className="flex shrink-0 gap-1">
              <Button size="sm" variant="outline" onClick={() => setDraft({ ...candidate })}>
                {t('common.edit')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void remove(candidate.id)}
              >
                {t('common.delete')}
              </Button>
            </div>
          </li>
        ))}
        {profiles.length === 0 && (
          <li className="text-sm text-muted-foreground">{t('settings.ai.empty')}</li>
        )}
      </ul>

      {!draft && (
        <Button size="sm" onClick={() => setDraft(blankProfile())}>
          {t('settings.ai.add')}
        </Button>
      )}

      {draft && (
        <AiProfileForm
          draft={draft}
          apiKey={apiKey}
          plaintextConfirmed={plaintextConfirmed}
          needsPlaintextConfirmation={needsPlaintextConfirmation}
          error={error}
          busy={busy}
          onChange={update}
          onApiKeyChange={setApiKey}
          onPlaintextConfirm={setPlaintextConfirmed}
          onSave={() => void save()}
          onCancel={() => setDraft(null)}
        />
      )}
    </div>
  )
}
