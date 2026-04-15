import type { SnippetRecord } from '@/service/database'
import { Code, Edit, Play, Search, Share2, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/view-container'
import { parseVariables } from './snippet-execute-dialog'

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
          const storedVars = snippet.variables ? JSON.parse(snippet.variables) : []
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
      onExecute({ ...snippet, _tempVariables: initialValues } as unknown as SnippetRecord)
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
            <div
              key={snippet.id}
              className="border rounded-lg p-3 hover:bg-accent/50 transition-colors"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <h4 className="font-medium flex items-center gap-2">
                    <Code className="h-4 w-4" />
                    {snippet.name}
                  </h4>
                  {snippet.description && (
                    <p className="text-sm text-muted-foreground mt-1 truncate">
                      {snippet.description}
                    </p>
                  )}
                  <pre className="text-xs bg-muted p-2 rounded mt-2 overflow-x-auto max-h-20">
                    {snippet.script.substring(0, 200)}
                    {snippet.script.length > 200 && '...'}
                  </pre>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleExecuteClick(snippet)}
                    title={t('snippets.execute')}
                  >
                    <Play className="h-4 w-4" />
                  </Button>
                  {isTeamEnabled && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onShare(snippet)}
                      title={t('teams.share')}
                    >
                      <Share2 className="h-4 w-4" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onEdit(snippet)}
                    title={t('snippets.editSnippet')}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('snippets.deleteSnippet')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t('snippets.deleteSnippet')}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('snippets.deleteSnippetConfirm', {
                            name: snippet.name,
                          })}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>
                          {t('common.cancel')}
                        </AlertDialogCancel>
                        <AlertDialogAction onClick={() => onDelete(snippet.id)}>
                          {t('common.delete')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
