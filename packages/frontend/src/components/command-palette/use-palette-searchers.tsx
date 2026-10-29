import type { CommandHistoryRecord, SnippetRecord } from '@/service/database'
import { Clock, Code, FileUp, Server } from 'lucide-react'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { getCommandHistory, searchSnippets } from '@/service/database'
import { useHostStore } from '@/store/host'
import { fuzzyMatch, fuzzyScore } from './command-palette-utils'
import type { SearchResult } from './command-palette-types'

export function usePaletteSearchers() {
  const { t } = useTranslation()
  const hosts = useHostStore(state => state.hosts)
  const searchHosts = useCallback(
    (query: string): SearchResult[] => {
      const targets = hosts.slice(0, 20)
      if (!query)
        return targets.map(host => ({
          id: host.id,
          type: 'host' as const,
          title: host.name,
          description: `${host.username}@${host.hostname}:${host.port}`,
          hint: t('cmdPalette.openSftpHint'),
          icon: <Server className="h-4 w-4" />,
          data: host,
          score: 0,
        }))
      return targets
        .filter(host =>
          fuzzyMatch(
            query,
            `${host.name} ${host.hostname} ${host.username} ${host.tags?.join(' ') ?? ''}`.toLowerCase(),
          ),
        )
        .map(host => ({
          id: host.id,
          type: 'host' as const,
          title: host.name,
          description: `${host.username}@${host.hostname}:${host.port}`,
          hint: t('cmdPalette.openSftpHint'),
          icon: <Server className="h-4 w-4" />,
          data: host,
          score: fuzzyScore(
            query,
            `${host.name} ${host.hostname} ${host.username}`,
          ),
        }))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 10)
    },
    [hosts, t],
  )
  const sftpActions = useCallback(
    (query: string): SearchResult[] => {
      if (!query && hosts.length === 0) return []
      const targets = hosts.slice(0, 20)
      const filtered = query
        ? targets.filter(
            host =>
              fuzzyMatch(query, host.name) || fuzzyMatch(query, host.hostname),
          )
        : targets
      return filtered
        .map(host => ({
          id: `sftp-${host.id}`,
          type: 'sftp' as const,
          title: t('cmdPalette.openSftpSession', { host: host.name }),
          description: `${host.username}@${host.hostname}:${host.port}`,
          hint: t('cmdPalette.openSftpHint'),
          icon: <FileUp className="h-4 w-4" />,
          data: { host },
          score: query ? fuzzyScore(query, host.name) : 0,
        }))
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, 10)
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
            icon: <Code className="h-4 w-4" />,
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
            description: `Executed ${new Date(record.executed_at).toLocaleDateString()}`,
            icon: <Clock className="h-4 w-4" />,
            data: record,
            score: fuzzyScore(query, record.command),
          }))
      } catch {
        return []
      }
    },
    [],
  )
  return { searchHosts, sftpActions, searchSnippetsAction, searchHistory }
}
