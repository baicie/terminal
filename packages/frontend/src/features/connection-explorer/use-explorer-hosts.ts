import { useCallback, useEffect, useState } from 'react'
import { useHostStore } from '@/store/host'
import {
  loadRecentHosts,
  pickRecentHosts,
  type RecentHost,
} from './recent-connections'

/**
 * The Explorer's view of the host store.
 *
 * The panel reads `useHostStore` — it does not cache, copy or re-derive the host
 * list. Two consequences, both deliberate:
 *
 * - a host edited on the Hosts page shows the new name here on the next render,
 *   with no refresh path to get wrong;
 * - a failed recency read leaves `hosts` (and therefore favourites, groups and
 *   search) exactly as they were. The failure degrades one section, never the
 *   panel and never the terminal, which never reads this hook at all.
 */
export interface ExplorerHostData {
  hosts: ReturnType<typeof useHostStore.getState>['hosts']
  groups: ReturnType<typeof useHostStore.getState>['groups']
  loading: boolean
  /**
   * Set only when the host list itself could not be read. A recency failure is
   * *not* reported here: it is not a reason to tell the user their hosts are
   * broken when they are not.
   */
  loadError: string | null
  dbAvailable: boolean
  recent: RecentHost[]
  recentFailed: boolean
  reload: () => void
  toggleFavorite: (hostId: string) => void
}

export function useExplorerHosts(active: boolean): ExplorerHostData {
  const hosts = useHostStore(state => state.hosts)
  const groups = useHostStore(state => state.groups)
  const loading = useHostStore(state => state.loading)
  const dbAvailable = useHostStore(state => state.dbAvailable)
  const loadHosts = useHostStore(state => state.loadHosts)
  const toggleFavoriteAction = useHostStore(state => state.toggleFavorite)
  const loadGroups = useHostStore(state => state.loadGroups)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [recent, setRecent] = useState<RecentHost[]>([])
  const [recentFailed, setRecentFailed] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!active) return
    const controller = new AbortController()
    setLoadError(null)
    void loadHosts(controller.signal)
      .then(rows => {
        // `null` means another call owns the generation; leave the reported error
        // alone rather than clearing a message this call did not produce.
        if (rows === null || controller.signal.aborted) return
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        // The store keeps whatever hosts it already had; only this message is new.
        setLoadError(error instanceof Error ? error.message : String(error))
      })
    void loadGroups().catch(() => {
      // Groups are decoration. A failure here leaves every host in the ungrouped
      // section rather than blocking the panel.
    })
    return () => controller.abort()
  }, [active, loadHosts, loadGroups, reloadToken])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    void loadRecentHosts(hosts)
      .then(rows => {
        if (cancelled) return
        setRecent(rows)
        setRecentFailed(false)
      })
      .catch(() => {
        if (cancelled) return
        // Degrade one section; keep whatever was shown.
        setRecentFailed(true)
        setRecent(current => (current.length > 0 ? current : []))
      })
    return () => {
      cancelled = true
    }
    // `hosts` is a dependency on purpose: after a connect the log gains a row, and
    // re-reading is what makes the Recent section catch up. The cost is one query
    // per host-list change, which is a user action, not a render loop.
  }, [active, hosts])

  const reload = useCallback(() => setReloadToken(token => token + 1), [])
  const toggleFavorite = useCallback(
    (hostId: string) => toggleFavoriteAction(hostId),
    [toggleFavoriteAction],
  )

  return {
    hosts,
    groups,
    loading,
    loadError,
    dbAvailable,
    recent,
    recentFailed,
    reload,
    toggleFavorite,
  }
}

export { pickRecentHosts }
