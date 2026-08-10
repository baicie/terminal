import type { Workspace } from '@/types'
import { Check, Cloud, Plus, Settings } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { useWorkspaceStore } from '@/store/workspace'

export function TitleBarWorkspaceSwitcher({
  onSettingsClick,
}: {
  onSettingsClick?: () => void
}) {
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const workspaceStore = useWorkspaceStore()
  const activeWorkspace = useWorkspaceStore(state => state.activeWorkspace())
  const workspaces = useWorkspaceStore(state => state.workspaces)

  useEffect(() => {
    void workspaceStore.loadWorkspaces()
  }, [workspaceStore])

  const handleCreateWorkspace = async () => {
    if (!newName.trim()) return
    await workspaceStore.addWorkspace({
      name: newName.trim(),
      icon: '📁',
      color: '#3b82f6',
    })
    setNewName('')
    setIsCreating(false)
  }

  const handleSelectWorkspace = async (workspace: Workspace) => {
    await workspaceStore.setActiveWorkspace(workspace.id)
  }

  const handleSaveEdit = async () => {
    if (editingId && editName.trim()) {
      await workspaceStore.updateWorkspace(editingId, { name: editName.trim() })
    }
    setEditingId(null)
    setEditName('')
  }

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      if (isCreating) void handleCreateWorkspace()
      else if (editingId) void handleSaveEdit()
    } else if (event.key === 'Escape') {
      setIsCreating(false)
      setEditingId(null)
      setEditName('')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-2 px-2 text-xs text-[#cccccc] hover:bg-[#3c3c3c]"
        >
          <Cloud data-icon="inline-start" />
          <span className="max-w-[80px] truncate">
            {activeWorkspace?.name || 'Vaults'}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <div className="px-2 py-1.5 text-xs font-medium uppercase text-muted-foreground">
          Workspaces
        </div>
        {workspaces.map(workspace => (
          <DropdownMenuItem
            key={workspace.id}
            onSelect={() => void handleSelectWorkspace(workspace)}
            className="flex cursor-pointer items-center gap-2 py-2"
          >
            {editingId === workspace.id ? (
              <Input
                ref={inputRef}
                value={editName}
                onChange={event => setEditName(event.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => void handleSaveEdit()}
                className="h-6 text-sm"
                onClick={event => event.stopPropagation()}
              />
            ) : (
              <>
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: workspace.color || '#3b82f6' }}
                />
                <span className="flex-1 truncate">{workspace.name}</span>
                {workspace.isActive && (
                  <Check className="shrink-0 text-primary" />
                )}
              </>
            )}
          </DropdownMenuItem>
        ))}
        {isCreating ? (
          <div className="flex items-center gap-2 px-2 py-2">
            <Input
              autoFocus
              placeholder="Workspace name..."
              value={newName}
              onChange={event => setNewName(event.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (!newName.trim()) setIsCreating(false)
              }}
              className="h-7 text-sm"
            />
          </div>
        ) : (
          <DropdownMenuItem
            onSelect={() => setIsCreating(true)}
            className="flex cursor-pointer items-center gap-2"
          >
            <Plus />
            <span>New Workspace</span>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={onSettingsClick}
          className="flex cursor-pointer items-center gap-2"
        >
          <Settings />
          <span>Settings</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
