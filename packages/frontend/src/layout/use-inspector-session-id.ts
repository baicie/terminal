/**
 * The backend session id for the tab behind a panel.
 *
 * ## Why a hook and not a direct read
 *
 * The value changes when a session connects, reconnects or ends, and the panel has to
 * see each change: the Inspector is disabled while there is no id and must re-enable
 * after a reconnect without the user doing anything.
 *
 * Reading `sessionIdForTab` once during render would also read the *previous* tab's id
 * for one frame after a tab switch, because the publish happens in an effect — the
 * Inspector would fire one exec at the old session before the new value landed.
 *
 * ## Why it is gated on the panel being open
 *
 * Only one occupant renders at a time. Subscribing unconditionally would re-render the
 * whole panel on every session change even while the Inspector is closed, which is a
 * needless cost on the terminal's hot path.
 */

import { useEffect, useReducer } from 'react'
import { sessionIdForTab, subscribeTerminalSessionIds } from '@/features/terminal/services/terminal-session-ids'

export function useInspectorSessionId(active: boolean, tabId: string | null): string | null {
  const [, forceRender] = useReducer((value: number) => value + 1, 0)

  useEffect(() => {
    if (!active) return
    return subscribeTerminalSessionIds(() => forceRender())
  }, [active])

  if (!active || tabId === null) return null
  return sessionIdForTab(tabId)
}
