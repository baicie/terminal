import type { CommandHistoryRecord, SnippetRecord } from '@/service/database'
import { Clock, Code, FileUp, Server } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getCommandHistory, searchSnippets } from '@/service/database'
import { useHostStore } from '@/store/host'
import { fuzzyMatch, fuzzyScore } from './command-palette-utils'
import { rankHosts } from './host-ranking'
import type { SearchResult } from './command-palette-types'

export function usePaletteSearchers() {
  const { t } = useTranslation()
  const hosts = useHostStore(state => state.hosts)
  const searchHosts = useCallback(
    (query: string): SearchResult[] => {
      // Rank the *whole* host list, then limit what is displayed. Truncating
      // first made every host past the 20th unreachable (Phase 10 audit B1).
      return rankHosts(hosts, query, { limit: 10 }).map(entry => ({
        id: entry.host.id,
        type: 'host' as const,
        title: entry.host.name,
        description: `${entry.host.username}@${entry.host.hostname}:${entry.host.port}`,
        hint: t('cmdPalette.openSftpHint'),
        icon: <Server className="size-4" />,
        data: entry.host,
        score: entry.score,
      }))
    },
    [hosts, t],
  )
  const sftpActions = useCallback(
    (query: string): SearchResult[] => {
      if (!query && hosts.length === 0) return []
      // Same rule as the host searcher: rank everything, then limit.
      return rankHosts(hosts, query, { limit: 10 }).map(entry => ({
        id: `sftp-${entry.host.id}`,
        type: 'sftp' as const,
        title: t('cmdPalette.openSftpSession', { host: entry.host.name }),
        description: `${entry.host.username}@${entry.host.hostname}:${entry.host.port}`,
        hint: t('cmdPalette.openSftpHint'),
        icon: <FileUp className="size-4" />,
        data: { host: entry.host },
        score: entry.score,
      }))
    },
    [hosts, t],
  )
  const searchSnippetsAction = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      if (!query) return []
      try {
        return (await searchSnippets(query))
          .slice(0, 10)
          .map((snippet: SnippetRecord) => ({
            id: snippet.id,
            type: 'snippet',
            title: snippet.name,
            description: snippet.description || snippet.script.slice(0, 50),
            icon: <Code className="size-4" />,
            data: snippet,
            score: fuzzyScore(query, snippet.name),
          }))
      } catch {
        return []
      }
    },
    [],
  )
  const searchHistory = useCallback(
    async (query: string): Promise<SearchResult[]> => {
      if (!query) return []
      try {
        return (await getCommandHistory(undefined, 20))
          .filter(record => fuzzyMatch(query, record.command))
          .slice(0, 10)
          .map((record: CommandHistoryRecord) => ({
            id: `history-${record.id}`,
            type: 'history',
            title: record.command,
            description: t('cmdPalette.executedOn', {
              date: new Date(record.executed_at).toLocaleDateString(),
            }),
            icon: <Clock className="size-4" />,
            data: record,
            score: fuzzyScore(query, record.command),
          }))
      } catch {
        return []
      }
    },
    [t],
  )
  return { searchHosts, sftpActions, searchSnippetsAction, searchHistory }
}
