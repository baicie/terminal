import { useState, useRef, useEffect } from "react";
import { observer } from "mobx-react-lite";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Layers,
  Plus,
  Settings,
  Trash2,
  Check,
  FolderOpen,
} from "lucide-react";
import { useInjectable } from "@/hooks/use-di";
import { WorkspaceStore } from "@/store/workspace";
import type { Workspace } from "@/types";

interface WorkspaceSwitcherProps {
  onSettingsClick?: () => void;
}

const WorkspaceSwitcher: React.FC<WorkspaceSwitcherProps> = observer(({ onSettingsClick }) => {
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const workspaceStore = useInjectable(WorkspaceStore);

  useEffect(() => {
    workspaceStore.loadWorkspaces();
  }, [workspaceStore]);

  const handleCreateWorkspace = async () => {
    if (!newName.trim()) return;

    await workspaceStore.addWorkspace({
      name: newName.trim(),
      icon: "📁",
      color: "#3b82f6",
    });

    setNewName("");
    setIsCreating(false);
  };

  const handleSelectWorkspace = async (workspace: Workspace) => {
    // Save current layout before switching
    if (workspaceStore.activeWorkspaceId) {
      // Get current layout from AppStore - for now just save
    }

    await workspaceStore.setActiveWorkspace(workspace.id);

    // TODO: Load layout for selected workspace
  };

  const handleDeleteWorkspace = async (e: React.MouseEvent, workspace: Workspace) => {
    e.stopPropagation();

    if (workspaceStore.workspaces.length <= 1) {
      alert("Cannot delete the last workspace");
      return;
    }

    if (confirm(`Delete workspace "${workspace.name}"?`)) {
      await workspaceStore.deleteWorkspace(workspace.id);
    }
  };

  const handleSaveEdit = async () => {
    if (editingId && editName.trim()) {
      await workspaceStore.updateWorkspace(editingId, { name: editName.trim() });
    }
    setEditingId(null);
    setEditName("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      if (isCreating) {
        handleCreateWorkspace();
      } else if (editingId) {
        handleSaveEdit();
      }
    } else if (e.key === "Escape") {
      setIsCreating(false);
      setEditingId(null);
      setEditName("");
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
        >
          <Layers className="h-4 w-4" />
          <span className="max-w-[100px] truncate">
            {workspaceStore.activeWorkspace?.name || "Workspace"}
          </span>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64">
        <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
          Workspaces
        </div>

        {workspaceStore.workspaces.map((workspace) => (
          <DropdownMenuItem
            key={workspace.id}
            onSelect={() => handleSelectWorkspace(workspace)}
            className="flex items-center gap-2 cursor-pointer py-2"
          >
            {editingId === workspace.id ? (
              <Input
                ref={inputRef}
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleSaveEdit}
                className="h-6 text-sm"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: workspace.color || "#3b82f6" }}
                />
                <span className="flex-1 truncate">{workspace.name}</span>
                {workspace.isActive && (
                  <Check className="h-4 w-4 text-primary shrink-0" />
                )}
                <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(workspace.id);
                      setEditName(workspace.name);
                      setTimeout(() => inputRef.current?.focus(), 0);
                    }}
                    className="p-1 hover:bg-muted rounded"
                    title="Rename"
                  >
                    <Settings className="h-3 w-3" />
                  </button>
                  {workspaceStore.workspaces.length > 1 && (
                    <button
                      onClick={(e) => handleDeleteWorkspace(e, workspace)}
                      className="p-1 hover:bg-destructive/10 hover:text-destructive rounded"
                      title="Delete"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </>
            )}
          </DropdownMenuItem>
        ))}

        {isCreating ? (
          <div className="px-2 py-2 flex items-center gap-2">
            <Input
              autoFocus
              placeholder="Workspace name..."
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={() => {
                if (!newName.trim()) setIsCreating(false);
              }}
              className="h-8 text-sm"
            />
          </div>
        ) : (
          <DropdownMenuItem
            onSelect={() => setIsCreating(true)}
            className="flex items-center gap-2 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>New Workspace</span>
          </DropdownMenuItem>
        )}

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={onSettingsClick}
          className="flex items-center gap-2 cursor-pointer"
        >
          <FolderOpen className="h-4 w-4" />
          <span>Manage Workspaces</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

export default WorkspaceSwitcher;
