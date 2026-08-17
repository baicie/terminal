import type { Workspace } from '@/types'
import { Check, Cloud, FolderOpen, Layers, Plus } from 'lucide-react'
import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/sonner'
import { switchWorkspaceLayout } from '@/service/workspace-switch'
import { useWorkspaceStore } from '@/store/workspace'

const WorkspaceManagerDialog = lazy(() =>
  import('./workspace-manager-dialog').then(module => ({
    default: module.WorkspaceManagerDialog,
  })),
)

interface WorkspaceSwitcherProps {
  onSettingsClick?: () => void
  /** 与产品参考图一致：顶栏显示为 Vaults */
  variant?: 'workspace' | 'vaults'
}

const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = ({
  onSettingsClick,
  variant = 'workspace',
}) => {
  const { t } = useTranslation()
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [managerOpen, setManagerOpen] = useState(false)
  const loadWorkspaces = useWorkspaceStore(s => s.loadWorkspaces)
  const addWorkspace = useWorkspaceStore(s => s.addWorkspace)
  const activeWorkspaceId = useWorkspaceStore(s => s.activeWorkspaceId)
  const workspaces = useWorkspaceStore(s => s.workspaces)
  const activeWorkspace = workspaces.find(
    workspace => workspace.id === activeWorkspaceId,
  )

  useEffect(() => {
    void loadWorkspaces()
  }, [loadWorkspaces])

  const handleCreateWorkspace = async () => {
    if (!newName.trim()) return

    await addWorkspace({
      name: newName.trim(),
      icon: '📁',
      color: '#3b82f6',
    })

    setNewName('')
    setIsCreating(false)
  }

  const handleSelectWorkspace = async (workspace: Workspace) => {
    if (workspace.id === activeWorkspaceId) return
    try {
      await switchWorkspaceLayout(workspace.id)
    } catch (error) {
      toast.error(t('workspace.switchFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (isCreating) void handleCreateWorkspace()
    } else if (e.key === 'Escape') {
      setIsCreating(false)
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-2 px-2.5 text-muted-foreground hover:text-foreground"
            data-tauri-drag-region="false"
          >
            {variant === 'vaults' ? (
              <Cloud data-icon="inline-start" />
            ) : (
              <Layers data-icon="inline-start" />
            )}
            <span className="max-w-[100px] truncate text-sm">
              {variant === 'vaults'
                ? t('vaults.title')
                : activeWorkspace?.name || t('workspace.workspaces')}
            </span>
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs uppercase text-muted-foreground">
            {t('workspace.workspaces')}
          </DropdownMenuLabel>

          <DropdownMenuGroup>
            {workspaces.map(workspace => (
              <DropdownMenuItem
                key={workspace.id}
                onSelect={() => void handleSelectWorkspace(workspace)}
                className="flex cursor-pointer items-center gap-2 py-2"
              >
                <span
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: workspace.color || '#3b82f6' }}
                />
                <span className="flex-1 truncate">{workspace.name}</span>
                {workspace.isActive ? (
                  <Check className="shrink-0 text-primary" />
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>

          {isCreating ? (
            <div className="flex items-center gap-2 px-2 py-2">
              <Input
                autoFocus
                placeholder={t('workspace.workspaceName')}
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => {
                  if (!newName.trim()) setIsCreating(false)
                }}
                className="h-8 text-sm"
              />
            </div>
          ) : (
            <DropdownMenuGroup>
              <DropdownMenuItem
                onSelect={() => setIsCreating(true)}
                className="flex cursor-pointer items-center gap-2"
              >
                <Plus />
                <span>{t('workspace.newWorkspace')}</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          )}

          <DropdownMenuSeparator />

          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => {
                if (onSettingsClick) onSettingsClick()
                else setManagerOpen(true)
              }}
              className="flex cursor-pointer items-center gap-2"
            >
              <FolderOpen />
              <span>{t('workspace.manageWorkspaces')}</span>
            </DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {managerOpen ? (
        <Suspense fallback={null}>
          <WorkspaceManagerDialog
            open={managerOpen}
            onOpenChange={setManagerOpen}
          />
        </Suspense>
      ) : null}
    </>
  )
}

export default WorkspaceSwitcher
