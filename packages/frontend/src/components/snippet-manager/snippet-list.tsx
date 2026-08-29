import type { SnippetRecord } from '@/service/database'
import { Code, Search } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/view-container'
import { parseVariables } from './snippet-execute-dialog'
import { SnippetListItem } from './snippet-list-item'

interface SnippetListProps {
  snippets: SnippetRecord[]
  searchQuery: string
  onSearchChange: (query: string) => void
  onCreateNew?: () => void
  onEdit: (snippet: SnippetRecord) => void
  onDelete: (id: string) => void
  onExecute: (snippet: SnippetRecord) => void
  onShare: (snippet: SnippetRecord) => void
  isTeamEnabled: boolean
}

export const SnippetList: React.FC<SnippetListProps> = ({
  snippets,
  searchQuery,
  onSearchChange,
  onCreateNew,
  onEdit,
  onDelete,
  onExecute,
  onShare,
  isTeamEnabled,
}) => {
  const { t } = useTranslation()

  const filteredSnippets = snippets.filter(
    s =>
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.description?.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const handleExecuteClick = (snippet: SnippetRecord) => {
    const variables = parseVariables(snippet.script)
    if (variables.length > 0) {
      // Open dialog to enter variable values
      const initialValues: Record<string, string> = {}
      variables.forEach(v => {
        try {
          const storedVars = snippet.variables
            ? JSON.parse(snippet.variables)
            : []
          const varDef = storedVars.find(
            (v2: { name: string; defaultValue?: string }) => v2.name === v,
          )
          if (varDef?.defaultValue) {
            initialValues[v] = varDef.defaultValue
          }
        } catch {
          /* ignore */
        }
      })
      onExecute({
        ...snippet,
        _tempVariables: initialValues,
      } as unknown as SnippetRecord)
    } else {
      onExecute(snippet)
    }
  }

  const hasNoSnippets = snippets.length === 0
  const noMatches =
    !hasNoSnippets && filteredSnippets.length === 0 && searchQuery.trim() !== ''

  return (
    <div className="flex h-full min-h-[200px] flex-col">
      <div className="mb-4 flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('snippets.searchSnippets')}
            className="h-9 pl-9"
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {filteredSnippets.length === 0 ? (
          <EmptyState
            className="min-h-[220px] py-10"
            icon={<Code className="size-12 stroke-[1.25]" />}
            title={
              noMatches
                ? t('snippets.noMatch')
                : hasNoSnippets
                  ? t('snippets.emptyTitle')
                  : t('snippets.noSnippets')
            }
            description={
              noMatches
                ? t('snippets.noMatchDesc')
                : hasNoSnippets
                  ? t('snippets.emptyDesc')
                  : undefined
            }
            action={
              hasNoSnippets && onCreateNew ? (
                <Button onClick={onCreateNew}>{t('snippets.new')}</Button>
              ) : undefined
            }
          />
        ) : (
          filteredSnippets.map(snippet => (
            <SnippetListItem
              key={snippet.id}
              snippet={snippet}
              isTeamEnabled={isTeamEnabled}
              onExecute={handleExecuteClick}
              onShare={onShare}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </div>
  )
}
