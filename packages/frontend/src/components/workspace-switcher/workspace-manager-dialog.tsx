import type { Workspace } from '@/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/sonner'
import { deleteWorkspaceAndSwitch } from '@/service/workspace-switch'
import { useWorkspaceStore } from '@/store/workspace'
import { WorkspaceDeleteDialog } from './workspace-delete-dialog'
import { WorkspaceManagerItem } from './workspace-manager-item'

interface WorkspaceManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WorkspaceManagerDialog({
  open,
  onOpenChange,
}: WorkspaceManagerDialogProps) {
  const { t } = useTranslation()
  const workspaces = useWorkspaceStore(state => state.workspaces)
  const activeWorkspaceId = useWorkspaceStore(state => state.activeWorkspaceId)
  const updateWorkspace = useWorkspaceStore(state => state.updateWorkspace)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [deleteCandidate, setDeleteCandidate] = useState<Workspace | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) return
    setEditingId(null)
    setEditName('')
    setDeleteCandidate(null)
  }, [open])

  const beginRename = (workspace: Workspace) => {
    setEditingId(workspace.id)
    setEditName(workspace.name)
  }
  const cancelRename = () => {
    setEditingId(null)
    setEditName('')
  }
  const saveRename = async () => {
    if (!editingId || !editName.trim()) return
    setBusy(true)
    try {
      await updateWorkspace(editingId, { name: editName.trim() })
      cancelRename()
    } catch (error) {
      toast.error(t('workspace.renameFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }
  const confirmDelete = async () => {
    if (!deleteCandidate) return
    setBusy(true)
    try {
      await deleteWorkspaceAndSwitch(deleteCandidate.id)
      setDeleteCandidate(null)
    } catch (error) {
      toast.error(t('workspace.deleteFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[min(80vh,36rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('workspace.manageWorkspaces')}</DialogTitle>
            <DialogDescription>
              {t('workspace.manageDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col" role="list">
            {workspaces.map((workspace, index) => (
              <div key={workspace.id} role="listitem">
                {index > 0 ? <Separator /> : null}
                <WorkspaceManagerItem
                  workspace={workspace}
                  active={workspace.id === activeWorkspaceId}
                  editing={editingId === workspace.id}
                  editName={editName}
                  busy={busy}
                  canDelete={workspaces.length > 1}
                  onBeginRename={beginRename}
                  onEditName={setEditName}
                  onSaveRename={saveRename}
                  onCancelRename={cancelRename}
                  onDelete={setDeleteCandidate}
                />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <WorkspaceDeleteDialog
        workspace={deleteCandidate}
        busy={busy}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteCandidate(null)}
      />
    </>
  )
}
