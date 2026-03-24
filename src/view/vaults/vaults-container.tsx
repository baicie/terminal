import { useState, useEffect, useCallback } from "react";
import { observer } from "mobx-react-lite";
import { useInjectable } from "@/hooks/use-di";
import { AppStore } from "@/store/app";
import { HostStore } from "@/store/host";
import { vaultService } from "@/service/vault";
import { ViewContainer, ViewToolbar, ViewContent, ViewHeader, EmptyState } from "@/components/view-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Shield,
  Plus,
  Search,
  Lock,
  Unlock,
  Trash2,
  Key,
  Eye,
  EyeOff,
  Copy,
  CheckCircle,
  XCircle,
  ShieldCheck,
  Server,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { formatRelativeTime } from "@/lib/date-utils";

interface VaultEntry {
  key: string;
  value: string;
  description?: string;
}

const VaultsContainer: React.FC = observer(() => {
  const app = useInjectable(AppStore);
  const hostStore = useInjectable(HostStore);

  const [searchQuery, setSearchQuery] = useState("");
  const [vaultExists, setVaultExists] = useState<boolean | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<VaultEntry | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [unlockDialogOpen, setUnlockDialogOpen] = useState(false);
  const [addEntryDialogOpen, setAddEntryDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [entryToDelete, setEntryToDelete] = useState<VaultEntry | null>(null);
  const [changePasswordDialogOpen, setChangePasswordDialogOpen] = useState(false);

  // Form states
  const [masterPassword, setMasterPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [entryKey, setEntryKey] = useState("");
  const [entryValue, setEntryValue] = useState("");
  const [entryDescription, setEntryDescription] = useState("");

  // Check vault status
  const checkVaultStatus = useCallback(async () => {
    setLoading(true);
    try {
      const exists = await vaultService.exists();
      setVaultExists(exists);
      if (exists) {
        const unlocked = await vaultService.isUnlocked();
        setIsUnlocked(unlocked);
        if (unlocked) {
          await loadEntries();
        }
      }
    } catch (error) {
      console.error("Failed to check vault status:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkVaultStatus();
  }, [checkVaultStatus]);

  // Load entries
  const loadEntries = async () => {
    try {
      const keys = await vaultService.list();
      const loadedEntries: VaultEntry[] = [];
      for (const key of keys) {
        try {
          const value = await vaultService.get(key);
          loadedEntries.push({ key, value, description: undefined });
        } catch {
          // Key might have been deleted
        }
      }
      setEntries(loadedEntries);
    } catch (error) {
      console.error("Failed to load vault entries:", error);
    }
  };

  // Create vault
  const handleCreateVault = async () => {
    if (!masterPassword || masterPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (masterPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    try {
      await vaultService.create(masterPassword);
      toast.success("Vault created successfully");
      setVaultExists(true);
      setIsUnlocked(true);
      setCreateDialogOpen(false);
      setMasterPassword("");
      setConfirmPassword("");
      await loadEntries();
    } catch (error) {
      toast.error(`Failed to create vault: ${error}`);
    }
  };

  // Unlock vault
  const handleUnlock = async () => {
    if (!masterPassword) {
      toast.error("Please enter the password");
      return;
    }

    try {
      await vaultService.unlock(masterPassword);
      toast.success("Vault unlocked");
      setIsUnlocked(true);
      setUnlockDialogOpen(false);
      setMasterPassword("");
      await loadEntries();
    } catch (error) {
      toast.error(`Failed to unlock vault: ${error}`);
    }
  };

  // Lock vault
  const handleLock = async () => {
    try {
      await vaultService.lock();
      toast.success("Vault locked");
      setIsUnlocked(false);
      setEntries([]);
      setSelectedEntry(null);
    } catch (error) {
      toast.error(`Failed to lock vault: ${error}`);
    }
  };

  // Add entry
  const handleAddEntry = async () => {
    if (!entryKey.trim() || !entryValue.trim()) {
      toast.error("Key and value are required");
      return;
    }

    try {
      await vaultService.set(entryKey, entryValue);
      toast.success("Entry added successfully");
      setAddEntryDialogOpen(false);
      setEntryKey("");
      setEntryValue("");
      setEntryDescription("");
      await loadEntries();
    } catch (error) {
      toast.error(`Failed to add entry: ${error}`);
    }
  };

  // Delete entry
  const handleDeleteEntry = async () => {
    if (!entryToDelete) return;

    try {
      await vaultService.delete(entryToDelete.key);
      toast.success("Entry deleted");
      setEntries(entries.filter((e) => e.key !== entryToDelete.key));
      if (selectedEntry?.key === entryToDelete.key) {
        setSelectedEntry(null);
      }
      setDeleteDialogOpen(false);
      setEntryToDelete(null);
    } catch (error) {
      toast.error(`Failed to delete entry: ${error}`);
    }
  };

  // Change password
  const handleChangePassword = async () => {
    if (!masterPassword || !newPassword || newPassword !== confirmNewPassword) {
      toast.error("Passwords do not match or are empty");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }

    try {
      await vaultService.changePassword(masterPassword, newPassword);
      toast.success("Password changed successfully");
      setChangePasswordDialogOpen(false);
      setMasterPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (error) {
      toast.error(`Failed to change password: ${error}`);
    }
  };

  // Copy to clipboard
  const handleCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Failed to copy");
    }
  };

  // Auto-fill host credentials
  const handleAutofillHost = async (hostId: string) => {
    const host = hostStore.hosts.find((h) => h.id === hostId);
    if (!host) return;

    try {
      const creds = await vaultService.getHostCredential(hostId);
      if (creds.password) {
        setEntryKey(`host:${hostId}:password`);
        setEntryValue(creds.password);
      }
      if (creds.privateKey) {
        setEntryKey(`host:${hostId}:privateKey`);
        setEntryValue(creds.privateKey);
      }
      setAddEntryDialogOpen(true);
    } catch {
      toast.error("No credentials found for this host");
    }
  };

  // Filter entries
  const filteredEntries = entries.filter((e) =>
    e.key.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Loading state
  if (loading) {
    return (
      <ViewContainer>
        <ViewContent className="p-6">
          <div className="flex items-center justify-center h-full">
            <div className="text-muted-foreground">Loading vault...</div>
          </div>
        </ViewContent>
      </ViewContainer>
    );
  }

  // No vault exists
  if (vaultExists === false) {
    return (
      <ViewContainer>
        <ViewToolbar className="gap-4">
          <div className="flex-1" />
          <Button size="sm" onClick={() => setCreateDialogOpen(true)}>
            <Plus className="size-4 mr-1" data-icon="inline-start" />
            Create Vault
          </Button>
        </ViewToolbar>

        <ViewContent className="p-6">
          <ViewHeader
            title="Vaults"
            description="Encrypted storage for sensitive connection data"
          />

          <EmptyState
            icon={<Shield className="size-12" />}
            title="No vault exists"
            description="Create a vault to securely store sensitive connection credentials"
            action={
              <Button onClick={() => setCreateDialogOpen(true)}>
                <Plus className="size-4 mr-1" data-icon="inline-start" />
                Create Vault
              </Button>
            }
          />
        </ViewContent>

        {/* Create Vault Dialog */}
        <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Create New Vault</DialogTitle>
              <DialogDescription>
                Set a master password to encrypt your sensitive data. This password cannot be recovered.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">Master Password</Label>
                <Input
                  id="new-password"
                  type="password"
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                  placeholder="Enter master password"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Confirm Password</Label>
                <Input
                  id="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm master password"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreateVault()}>
                Create Vault
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </ViewContainer>
    );
  }

  // Vault exists but locked
  if (!isUnlocked) {
    return (
      <ViewContainer>
        <ViewToolbar className="gap-4">
          <div className="flex-1" />
          <Button size="sm" variant="outline" onClick={() => setChangePasswordDialogOpen(true)}>
            <Key className="size-4 mr-1" data-icon="inline-start" />
            Change Password
          </Button>
        </ViewToolbar>

        <ViewContent className="p-6">
          <ViewHeader title="Vault Locked" description="Enter your master password to unlock" />

          <div className="flex flex-col items-center justify-center gap-6 py-12">
            <div className="p-6 rounded-full bg-primary/10">
              <Lock className="size-16 text-primary" />
            </div>
            <div className="text-center space-y-2">
              <p className="text-lg font-medium">Your vault is locked</p>
              <p className="text-sm text-muted-foreground">
                Enter your master password to access your credentials
              </p>
            </div>
            <Button size="lg" onClick={() => setUnlockDialogOpen(true)}>
              <Unlock className="size-4 mr-2" />
              Unlock Vault
            </Button>
          </div>
        </ViewContent>

        {/* Unlock Dialog */}
        <Dialog open={unlockDialogOpen} onOpenChange={setUnlockDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Unlock Vault</DialogTitle>
              <DialogDescription>Enter your master password</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="unlock-password">Master Password</Label>
                <Input
                  id="unlock-password"
                  type="password"
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                  placeholder="Enter master password"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleUnlock();
                  }}
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setUnlockDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleUnlock()}>
                Unlock
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Change Password Dialog */}
        <Dialog open={changePasswordDialogOpen} onOpenChange={setChangePasswordDialogOpen}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle>Change Master Password</DialogTitle>
              <DialogDescription>Enter your current and new password</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Current Password</Label>
                <Input
                  id="current-password"
                  type="password"
                  value={masterPassword}
                  onChange={(e) => setMasterPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-pw">New Password</Label>
                <Input
                  id="new-pw"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-new-pw">Confirm New Password</Label>
                <Input
                  id="confirm-new-pw"
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setChangePasswordDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleChangePassword()}>
                Change Password
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </ViewContainer>
    );
  }

  // Vault unlocked - main view
  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search vault..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={handleLock}>
          <Lock className="size-4 mr-1" data-icon="inline-start" />
          Lock
        </Button>

        <Button size="sm" onClick={() => setAddEntryDialogOpen(true)}>
          <Plus className="size-4 mr-1" data-icon="inline-start" />
          Add Entry
        </Button>
      </ViewToolbar>

      <ViewContent className="p-6 flex gap-6 min-h-0">
        {/* Entry list */}
        <div className="w-80 shrink-0 flex flex-col gap-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ShieldCheck className="size-4 text-green-500" />
            Vault unlocked
          </div>

          {filteredEntries.length === 0 ? (
            <div className="text-center text-muted-foreground text-sm py-8">
              {searchQuery ? "No matching entries" : "No entries yet"}
            </div>
          ) : (
            <ScrollArea className="flex-1">
              <div className="space-y-1 pr-4">
                {filteredEntries.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                      selectedEntry?.key === entry.key
                        ? "bg-primary/10 border border-primary/20"
                        : "hover:bg-accent/50"
                    }`}
                    onClick={() => setSelectedEntry(entry)}
                  >
                    <div className="flex items-center gap-2">
                      {entry.key.startsWith("host:") ? (
                        <Server className="size-4 text-blue-500 shrink-0" />
                      ) : (
                        <Key className="size-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">
                          {entry.key.split(":").pop() || entry.key}
                        </div>
                        <div className="text-xs text-muted-foreground truncate">
                          {entry.key}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}
        </div>

        {/* Entry detail */}
        {selectedEntry ? (
          <div className="flex-1 min-w-0">
            <div className="bg-card border rounded-xl p-6">
              <div className="flex items-start justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold">Entry Details</h3>
                  <p className="text-sm text-muted-foreground mt-1 font-mono truncate">
                    {selectedEntry.key}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleCopy(selectedEntry.value)}
                    title="Copy value"
                  >
                    <Copy className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="hover:text-destructive"
                    onClick={() => {
                      setEntryToDelete(selectedEntry);
                      setDeleteDialogOpen(true);
                    }}
                    title="Delete entry"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="text-muted-foreground">Value</Label>
                  <div className="relative">
                    <Textarea
                      className="font-mono text-sm min-h-[100px] pr-12"
                      value={selectedEntry.value}
                      readOnly
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-2 top-2"
                      onClick={() => setShowPassword(!showPassword)}
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" />
                      ) : (
                        <Eye className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {selectedEntry.key.startsWith("host:") && (
                  <div className="pt-4 border-t">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        const hostId = selectedEntry.key.split(":")[1];
                        if (hostId) {
                          void handleAutofillHost(hostId);
                        }
                      }}
                    >
                      <Server className="size-4 mr-1" />
                      Autofill Host Credentials
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <Shield className="size-12 mx-auto mb-4 opacity-50" />
              <p>Select an entry to view details</p>
            </div>
          </div>
        )}
      </ViewContent>

      {/* Add Entry Dialog */}
      <Dialog open={addEntryDialogOpen} onOpenChange={setAddEntryDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Vault Entry</DialogTitle>
            <DialogDescription>Store a sensitive value securely</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="entry-key">Key</Label>
              <Input
                id="entry-key"
                value={entryKey}
                onChange={(e) => setEntryKey(e.target.value)}
                placeholder="e.g., host:123:password or api-key"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entry-value">Value</Label>
              <Textarea
                id="entry-value"
                value={entryValue}
                onChange={(e) => setEntryValue(e.target.value)}
                placeholder="Sensitive value..."
                className="font-mono text-sm min-h-[120px]"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="entry-desc">Description (optional)</Label>
              <Input
                id="entry-desc"
                value={entryDescription}
                onChange={(e) => setEntryDescription(e.target.value)}
                placeholder="Description..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddEntryDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleAddEntry()} disabled={!entryKey.trim() || !entryValue.trim()}>
              Add Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Entry</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{entryToDelete?.key}"?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setEntryToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDeleteEntry()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ViewContainer>
  );
});

export default VaultsContainer;
