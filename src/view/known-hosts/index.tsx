import { useEffect, useState, useCallback } from "react";
import { ViewContainer, ViewToolbar, ViewContent, ViewHeader, EmptyState } from "@/components/view-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import {
  Fingerprint,
  Upload,
  Trash2,
  Search,
  Shield,
  Server,
  Key,
} from "lucide-react";
import {
  getKnownHosts,
  searchKnownHosts,
  addKnownHosts,
  deleteKnownHost,
  clearAllKnownHosts,
  KnownHostRecord,
} from "@/service/database";
import { format } from "@/lib/date-utils";

const KnownHostsView: React.FC = () => {
  const [hosts, setHosts] = useState<KnownHostRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [hostToDelete, setHostToDelete] = useState<KnownHostRecord | null>(null);
  const [clearAllDialogOpen, setClearAllDialogOpen] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importContent, setImportContent] = useState("");
  const [importError, setImportError] = useState("");
  const [selectedHost, setSelectedHost] = useState<KnownHostRecord | null>(null);

  const loadHosts = async () => {
    setLoading(true);
    try {
      const data = await getKnownHosts();
      setHosts(data);
    } catch (error) {
      console.error("Failed to load known hosts:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHosts();
  }, []);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query.trim()) {
      const results = await searchKnownHosts(query);
      setHosts(results);
    } else {
      loadHosts();
    }
  };

  const handleDelete = async () => {
    if (hostToDelete) {
      await deleteKnownHost(hostToDelete.id);
      setHosts(hosts.filter((h) => h.id !== hostToDelete.id));
      setHostToDelete(null);
      setDeleteDialogOpen(false);
    }
  };

  const handleClearAll = async () => {
    await clearAllKnownHosts();
    setHosts([]);
    setClearAllDialogOpen(false);
  };

  const parseKnownHostsLine = (line: string): { hostname: string; port: number; fingerprint: string; key_type: string } | null => {
    try {
      // Skip comments and empty lines
      if (line.trim().startsWith("#") || !line.trim()) {
        return null;
      }

      // Format: [hostname]:port ssh-rsa AAAA...
      // or: hostname ssh-rsa AAAA...
      const match = line.match(/^(?:\[([^\]]+)\]|([^\s]+))(?:\s+(\d+))?\s+(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp\d+)\s+([A-Za-z0-9+/=]+)/);
      if (!match) {
        return null;
      }

      const hostWithPort = match[1] || match[2];
      const port = match[3] ? parseInt(match[3], 10) : 22;
      const keyType = match[4];
      const fingerprint = match[5];

      // Parse hostname and port from [host]:port format
      const portMatch = hostWithPort.match(/^(.+):(\d+)$/);
      const hostname = portMatch ? portMatch[1] : hostWithPort;
      const finalPort = portMatch ? parseInt(portMatch[2], 10) : port;

      return { hostname, port: finalPort, fingerprint, key_type: keyType };
    } catch {
      return null;
    }
  };

  const handleImport = async () => {
    setImportError("");
    const lines = importContent.split("\n");
    const validHosts: Omit<KnownHostRecord, "id">[] = [];

    for (const line of lines) {
      const parsed = parseKnownHostsLine(line);
      if (parsed) {
        validHosts.push({
          hostname: parsed.hostname,
          port: parsed.port,
          fingerprint: parsed.fingerprint,
          key_type: parsed.key_type,
          added_at: Date.now(),
        });
      }
    }

    if (validHosts.length === 0) {
      setImportError("No valid SSH known hosts entries found. Format should be: hostname ssh-rsa KEY");
      return;
    }

    await addKnownHosts(validHosts);
    await loadHosts();
    setImportDialogOpen(false);
    setImportContent("");
  };

  const handleImportFromFile = useCallback(async () => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".known_hosts,.ssh";
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const text = await file.text();
          setImportContent(text);
          setImportDialogOpen(true);
        }
      };
      input.click();
    } catch (error) {
      console.error("Failed to import file:", error);
    }
  }, []);

  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search hosts..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={handleImportFromFile}>
          <Upload className="size-4 mr-1" data-icon="inline-start" />
          Import
        </Button>

        {hosts.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => setClearAllDialogOpen(true)}
          >
            <Trash2 className="size-4 mr-1" data-icon="inline-start" />
            Clear All
          </Button>
        )}
      </ViewToolbar>

      <ViewContent className="p-6">
        <ViewHeader
          title="Known Hosts"
          description="Manage SSH known host fingerprints"
        />

        {hosts.length === 0 && !loading ? (
          <EmptyState
            icon={<Fingerprint className="size-12" />}
            title="No known hosts"
            description="Import hosts from your SSH known_hosts file"
            action={
              <Button onClick={handleImportFromFile}>
                <Upload className="size-4 mr-1" data-icon="inline-start" />
                Import
              </Button>
            }
          />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {hosts.map((host) => (
                <div
                  key={host.id}
                  className="p-4 rounded-lg border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
                  onClick={() => setSelectedHost(host)}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-full bg-primary/10 text-primary">
                      <Server className="size-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{host.hostname}</div>
                      <div className="text-xs text-muted-foreground">
                        Port {host.port}
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 font-mono truncate">
                        {host.key_type}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setHostToDelete(host);
                        setDeleteDialogOpen(true);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </ViewContent>

      {/* Host Detail Dialog */}
      <Dialog open={!!selectedHost} onOpenChange={() => setSelectedHost(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Server className="size-5" />
              {selectedHost?.hostname}
            </DialogTitle>
            <DialogDescription>
              SSH Known Host Details
            </DialogDescription>
          </DialogHeader>
          {selectedHost && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm">
                <Key className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">Key Type:</span>
                <span className="font-mono">{selectedHost.key_type}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Shield className="size-4 text-muted-foreground" />
                <span className="text-muted-foreground">Port:</span>
                <span>{selectedHost.port}</span>
              </div>
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Fingerprint:</div>
                <div className="p-3 rounded-md bg-muted font-mono text-xs break-all">
                  {selectedHost.fingerprint}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                Added: {format(selectedHost.added_at, "MMM dd, yyyy HH:mm")}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="destructive" onClick={() => {
              if (selectedHost) {
                setHostToDelete(selectedHost);
                setSelectedHost(null);
                setDeleteDialogOpen(true);
              }
            }}>
              <Trash2 className="size-4 mr-1" data-icon="inline-start" />
              Delete
            </Button>
            <Button variant="outline" onClick={() => setSelectedHost(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Known Host</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the known host "{hostToDelete?.hostname}"?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setHostToDelete(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Clear All Confirmation Dialog */}
      <AlertDialog open={clearAllDialogOpen} onOpenChange={setClearAllDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear All Known Hosts</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete all {hosts.length} known hosts?
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setClearAllDialogOpen(false)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearAll}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import Known Hosts</DialogTitle>
            <DialogDescription>
              Paste your known_hosts file content below or import from file.
              Supported formats: OpenSSH known_hosts format.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Known Hosts Content</label>
              <textarea
                className="w-full h-48 p-3 rounded-md border bg-background font-mono text-xs"
                placeholder="Paste known_hosts content here..."
                value={importContent}
                onChange={(e) => setImportContent(e.target.value)}
              />
            </div>
            {importError && (
              <p className="text-sm text-destructive">{importError}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleImport}>
              <Upload className="size-4 mr-1" data-icon="inline-start" />
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ViewContainer>
  );
};

export default KnownHostsView;
