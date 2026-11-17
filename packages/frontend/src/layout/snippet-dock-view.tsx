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
import { ScrollArea } from '@/components/ui/scroll-area'
import type { SnippetDockHandle, SnippetDockState } from '@/features/extensions/snippet-dock-extension'

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
        <div className="border-b p-3" data-testid="snippet-draft">
          <p className="mb-1 text-xs text-muted-foreground">
            {t('extensions.snippetDock.draftHint')}
          </p>
          <pre className="max-h-24 overflow-auto rounded bg-muted p-2 text-xs">
            {state.pendingDraft.text}
          </pre>
        </div>
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
