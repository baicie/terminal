/**
 * The Snippet Dock's body.
 *
 * A presentational shell around `SnippetDockHandle`: the extension owns the data and
 * the registrations, this renders them. That split is the point — an extension that
 * owned a React component would have render access, and render access in the main
 * WebView is the whole privilege the registry exists to bound.
 *
 * The handle is created per activation, so this component never caches across an
 * enable/disable cycle: a stale handle would show rows from an extension that is no
 * longer running.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { SnippetDockHandle, SnippetDockState } from '@/features/extensions/snippet-dock-extension'
import { saveDraftAsSnippet } from '@/features/extensions/snippet-draft-save'

interface SnippetDockProps {
  /** Null while the extension is not active: the dock shows why, not an empty list. */
  handle: SnippetDockHandle | null
  onClose: () => void
}

export function SnippetDock({ handle, onClose }: SnippetDockProps) {
  const { t } = useTranslation()
  const [state, setState] = useState<SnippetDockState>(
    handle?.state() ?? { snippets: [], error: null, pendingDraft: null },
  )

  useEffect(() => {
    if (!handle) {
      setState({ snippets: [], error: null, pendingDraft: null })
      return
    }
    // Re-read on subscribe: the handle may have loaded between the initial
    // `state()` call and this effect, and a dock showing nothing while the data is
    // there is indistinguishable from an empty database.
    setState(handle.state())
    return handle.subscribe(() => setState(handle.state()))
  }, [handle])

  return (
    <div className="flex h-full flex-col" data-testid="snippet-dock">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <h2 className="text-sm font-medium">{t('extensions.snippetDock.name')}</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handle?.refresh()}
            disabled={!handle}
          >
            {t('common.refresh')}
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
      </div>

      {!handle && (
        <p className="p-3 text-sm text-muted-foreground">
          {t('extensions.snippetDock.notEnabled')}
        </p>
      )}

      {handle && state.error && (
        <p className="p-3 text-sm text-destructive" role="alert">
          {t('extensions.snippetDock.loadFailed', { error: state.error })}
        </p>
      )}

      {handle && state.pendingDraft && (
        <DraftPanel
          text={state.pendingDraft.text}
          onSaved={async () => {
            // Reload so the new row is in the list the user is looking at. Without this
            // the save succeeds and the dock still shows the old set, which reads as
            // "it did not save".
            await handle.refresh()
          }}
          onDiscard={() => void handle.discardDraft()}
        />
      )}

      <ScrollArea className="min-h-0 flex-1">
        <ul className="divide-y">
          {state.snippets.map(snippet => (
            <li key={snippet.id} className="px-3 py-2">
              <p className="truncate text-sm">{snippet.name}</p>
              <p className="truncate text-xs text-muted-foreground">{snippet.script}</p>
            </li>
          ))}
        </ul>
        {handle && !state.error && state.snippets.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">
            {t('extensions.snippetDock.empty')}
          </p>
        )}
      </ScrollArea>
    </div>
  )
}

/**
 * The captured draft, with the two things a user can do about it.
 *
 * Before this, the draft was rendered and nothing read it: the text appeared and then
 * the only route forward was a note pointing at the Snippets page — which has no
 * knowledge of a draft captured here. Naming and saving happens in place, because that
 * is where the text is.
 *
 * The script is shown verbatim and is saved verbatim. The user selected it; trimming or
 * reformatting would store something they did not choose.
 */
function DraftPanel({
  text,
  onSaved,
  onDiscard,
}: {
  text: string
  onSaved: () => Promise<void>
  onDiscard: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const save = async () => {
    if (busy) return
    setBusy(true)
    setFailure(null)
    const result = await saveDraftAsSnippet({ text, name })
    setBusy(false)
    if (!result.ok) {
      // The draft stays on screen: it is the only copy of the user's selection, and
      // discarding it because a write failed would mean selecting it again.
      setFailure(result.message)
      return
    }
    await onSaved()
  }

  return (
    <div className="border-b p-3" data-testid="snippet-draft">
      <p className="mb-1 text-xs text-muted-foreground">
        {t('extensions.snippetDock.draftHint')}
      </p>
      <pre className="mb-2 max-h-24 overflow-auto rounded bg-muted p-2 text-xs">{text}</pre>
      <div className="space-y-1">
        <Label htmlFor="snippet-draft-name">{t('extensions.snippetDock.draftName')}</Label>
        <Input
          id="snippet-draft-name"
          value={name}
          placeholder={t('extensions.snippetDock.draftNamePlaceholder')}
          onChange={event => {
            setName(event.target.value)
            setFailure(null)
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') void save()
          }}
        />
      </div>
      {failure && (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {failure}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={busy}>
          {t('extensions.snippetDock.draftSave')}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDiscard} disabled={busy}>
          {t('extensions.snippetDock.draftDiscard')}
        </Button>
      </div>
    </div>
  )
}
