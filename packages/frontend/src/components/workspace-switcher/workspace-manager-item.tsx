import type { Workspace } from '@/types'
import { Check, Pencil, Trash2, X } from 'lucide-react'
import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface WorkspaceManagerItemProps {
  workspace: Workspace
  active: boolean
  editing: boolean
  editName: string
  busy: boolean
  canDelete: boolean
  onBeginRename: (workspace: Workspace) => void
  onEditName: (name: string) => void
  onSaveRename: () => void
  onCancelRename: () => void
  onDelete: (workspace: Workspace) => void
}

export function WorkspaceManagerItem({
  workspace,
  active,
  editing,
  editName,
  busy,
  canDelete,
  onBeginRename,
  onEditName,
  onSaveRename,
  onCancelRename,
  onDelete,
}: WorkspaceManagerItemProps) {
  const { t } = useTranslation()
  const handleRenameKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter' && event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Enter') void onSaveRename()
    else onCancelRename()
  }

  return (
    <div className="flex min-h-12 items-center gap-3 py-2">
      <span
        className="size-3 shrink-0 rounded-full"
        style={{ backgroundColor: workspace.color || '#3b82f6' }}
      />
      {editing ? (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Label htmlFor={`workspace-name-${workspace.id}`} className="sr-only">
            {t('workspace.workspaceNameLabel')}
          </Label>
          <Input
            id={`workspace-name-${workspace.id}`}
            autoFocus
            value={editName}
            onChange={event => onEditName(event.target.value)}
            onKeyDown={handleRenameKeyDown}
            disabled={busy}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('common.save')}
            onClick={() => void onSaveRename()}
            disabled={busy || !editName.trim()}
          >
            <Check data-icon="inline-start" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('common.cancel')}
            onClick={onCancelRename}
            disabled={busy}
          >
            <X data-icon="inline-start" />
          </Button>
        </div>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {workspace.name}
          </span>
          {active ? (
            <Badge variant="secondary">{t('workspace.active')}</Badge>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('workspace.renameNamed', {
              name: workspace.name,
            })}
            onClick={() => onBeginRename(workspace)}
          >
            <Pencil data-icon="inline-start" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('workspace.deleteNamed', {
              name: workspace.name,
            })}
            onClick={() => onDelete(workspace)}
            disabled={!canDelete}
          >
            <Trash2 data-icon="inline-start" />
          </Button>
        </>
      )}
    </div>
  )
}
