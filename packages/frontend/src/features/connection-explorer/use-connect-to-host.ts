/**
 * The connect action, in one place.
 *
 * The Explorer must not invent a second way to open a session. `connectToHost`
 * below is the same two steps the Hosts page already performs — `addTab` then
 * `navigate` to the deep link — lifted into a hook so both surfaces call **one**
 * function instead of two copies that can drift.
 *
 * What it deliberately does not do:
 * - it does not call `terminalSessionManager` directly. The session is created by
 *   `TerminalContainer` when the tab renders; starting a session here would open a
 *   second PTY for the same tab.
 * - it does not pass credentials. Resolution happens on the connection path, from
 *   the host row's `credentialRef` (`terminal-launcher.ts`). A caller holding a
 *   `Host` object has no secret in it — the store strips them.
 */

import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { terminalTabPath } from '@/router/terminal-route'
import type { Host } from '@/types'

export interface ConnectToHost {
  /** Open a new tab for this host and navigate to it. */
  connectToHost: (host: Host) => void
  /** Toggle the stored favourite flag. */
  toggleFavorite: (hostId: string) => Promise<void>
}

export function useConnectToHost(): ConnectToHost {
  const navigate = useNavigate()
  const addTab = useAppStore(state => state.addTab)
  const toggleFavoriteAction = useHostStore(state => state.toggleFavorite)

  const connectToHost = useCallback(
    (host: Host) => {
      const tab = addTab({ label: host.name, type: 'remote', hostId: host.id })
      navigate(terminalTabPath(tab.id))
    },
    [addTab, navigate],
  )

  const toggleFavorite = useCallback(
    (hostId: string) => toggleFavoriteAction(hostId),
    [toggleFavoriteAction],
  )

  return { connectToHost, toggleFavorite }
}
