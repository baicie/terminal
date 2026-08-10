import { useCallback } from 'react'
import { fuzzyMatch } from './command-palette-utils'
import type { PaletteTab, SearchResult } from './command-palette-types'

interface PaletteSearchOptions {
  query: string
  activeTab: PaletteTab
  activeWorkspaceId?: string
  searchHosts: (query: string) => SearchResult[]
  sftpActions: (query: string) => SearchResult[]
  searchSnippets: (query: string) => Promise<SearchResult[]>
  searchHistory: (query: string) => Promise<SearchResult[]>
  quickActions: SearchResult[]
  openTabs: SearchResult[]
  closedTabs: SearchResult[]
  workspaceResults: SearchResult[]
  setResults: (results: SearchResult[]) => void
  setSelectedIndex: (index: number) => void
  setLoading: (loading: boolean) => void
}

export function usePaletteSearch(options: PaletteSearchOptions) {
  const {
    query,
    activeTab,
    activeWorkspaceId,
    searchHosts,
    sftpActions,
    searchSnippets,
    searchHistory,
    quickActions,
    openTabs,
    closedTabs,
    workspaceResults,
    setResults,
    setSelectedIndex,
    setLoading,
  } = options
  return useCallback(async () => {
    setLoading(true)
    try {
      const [snippets, history] = await Promise.all([
        searchSnippets(query),
        searchHistory(query),
      ])
      let filtered: SearchResult[]
      if (activeTab === 'all') {
        filtered = [
          ...(query ? [] : quickActions),
          ...searchHosts(query),
          ...sftpActions(query),
          ...snippets,
          ...history,
          ...(query ? [] : openTabs),
          ...(query ? [] : closedTabs),
          ...(query
            ? []
            : workspaceResults.filter(
                result => result.id !== activeWorkspaceId,
              )),
        ]
          .filter(
            result =>
              !query ||
              fuzzyMatch(query, result.title) ||
              fuzzyMatch(query, result.description ?? ''),
          )
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 20)
      } else if (activeTab === 'hosts') filtered = searchHosts(query)
      else if (activeTab === 'sftp') filtered = sftpActions(query)
      else if (activeTab === 'snippets') filtered = snippets
      else if (activeTab === 'history') filtered = history
      else if (activeTab === 'tabs')
        filtered = [
          ...openTabs.filter(
            result => !query || fuzzyMatch(query, result.title),
          ),
          ...closedTabs.filter(
            result => !query || fuzzyMatch(query, result.title),
          ),
        ]
      else if (activeTab === 'workspaces')
        filtered = workspaceResults.filter(
          result => result.id !== activeWorkspaceId,
        )
      else
        filtered = quickActions.filter(
          result => !query || fuzzyMatch(query, result.title),
        )
      setResults(filtered)
      setSelectedIndex(0)
    } finally {
      setLoading(false)
    }
  }, [
    query,
    activeTab,
    activeWorkspaceId,
    searchHosts,
    sftpActions,
    searchSnippets,
    searchHistory,
    quickActions,
    openTabs,
    closedTabs,
    workspaceResults,
    setResults,
    setSelectedIndex,
    setLoading,
  ])
}
