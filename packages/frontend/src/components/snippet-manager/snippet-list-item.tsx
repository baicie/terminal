import type { SnippetRecord } from '@/service/database'
import { Code, Edit, Play, Share2, Trash2 } from 'lucide-react'
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

interface SnippetListItemProps {
  snippet: SnippetRecord
  isTeamEnabled: boolean
  onExecute: (snippet: SnippetRecord) => void
  onShare: (snippet: SnippetRecord) => void
  onEdit: (snippet: SnippetRecord) => void
  onDelete: (id: string) => void
}

export const SnippetListItem: React.FC<SnippetListItemProps> = ({
  snippet,
  isTeamEnabled,
  onExecute,
  onShare,
  onEdit,
  onDelete,
}) => {
  const { t } = useTranslation()

  return (
    <div className="border rounded-lg p-3 hover:bg-accent/50 transition-colors">
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
            onClick={() => onExecute(snippet)}
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
                  {t('snippets.deleteSnippetConfirm', { name: snippet.name })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(snippet.id)}>
                  {t('common.delete')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  )
}
