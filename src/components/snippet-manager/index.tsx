import { useState, useEffect } from "react";
import { observer } from "mobx-react-lite";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  Edit,
  Trash2,
  Play,
  Search,
  FolderPlus,
  Code,
} from "lucide-react";
import {
  getSnippets,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  getSnippetPackages,
  createSnippetPackage,
  deleteSnippetPackage,
  type SnippetRecord,
  type SnippetPackageRecord,
} from "@/service/database";

interface SnippetDialogProps {
  open: boolean;
  onClose: () => void;
  onExecute?: (script: string) => void;
}

const SnippetManager: React.FC<SnippetDialogProps> = observer(
  ({ open, onClose, onExecute }) => {
    const [snippets, setSnippets] = useState<SnippetRecord[]>([]);
    const [packages, setPackages] = useState<SnippetPackageRecord[]>([]);
    const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState("");
    const [editingSnippet, setEditingSnippet] = useState<SnippetRecord | null>(
      null
    );
    const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
    const [isPackageDialogOpen, setIsPackageDialogOpen] = useState(false);
    const [isExecuteDialogOpen, setIsExecuteDialogOpen] = useState(false);
    const [executingSnippet, setExecutingSnippet] = useState<SnippetRecord | null>(null);
    const [variableValues, setVariableValues] = useState<Record<string, string>>({});
    const [newPackageName, setNewPackageName] = useState("");
    const [formData, setFormData] = useState({
      name: "",
      description: "",
      script: "",
      packageId: "",
      variables: "" as string | undefined,
    });

    useEffect(() => {
      loadData();
    }, [selectedPackage]);

    const loadData = async () => {
      try {
        const snippetData = await getSnippets(selectedPackage || undefined);
        setSnippets(snippetData);
        const packageData = await getSnippetPackages();
        setPackages(packageData);
      } catch (error) {
        console.error("Failed to load snippets:", error);
      }
    };

    const handleCreate = async () => {
      if (!formData.name || !formData.script) return;

      const newSnippet: SnippetRecord = {
        id: `snippet-${Date.now()}`,
        name: formData.name,
        description: formData.description,
        script: formData.script,
        package_id: formData.packageId || undefined,
      };

      try {
        await createSnippet(newSnippet);
        setIsCreateDialogOpen(false);
        setFormData({ name: "", description: "", script: "", packageId: "", variables: "" });
        loadData();
      } catch (error) {
        console.error("Failed to create snippet:", error);
      }
    };

    const handleUpdate = async () => {
      if (!editingSnippet) return;

      try {
        await updateSnippet(editingSnippet);
        setEditingSnippet(null);
        loadData();
      } catch (error) {
        console.error("Failed to update snippet:", error);
      }
    };

    const handleDelete = async (id: string) => {
      try {
        await deleteSnippet(id);
        loadData();
      } catch (error) {
        console.error("Failed to delete snippet:", error);
      }
    };

    const handleExecute = (script: string) => {
      if (onExecute) {
        onExecute(script);
      }
    };

    const handleCreatePackage = async () => {
      if (!newPackageName) return;

      const newPackage: SnippetPackageRecord = {
        id: `pkg-${Date.now()}`,
        name: newPackageName,
      };

      try {
        await createSnippetPackage(newPackage);
        setIsPackageDialogOpen(false);
        setNewPackageName("");
        loadData();
      } catch (error) {
        console.error("Failed to create package:", error);
      }
    };

    const filteredSnippets = snippets.filter(
      (s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        s.description?.toLowerCase().includes(searchQuery.toLowerCase())
    );

    // Parse variables from script (format: ${VAR_NAME} or $VAR_NAME)
    const parseVariables = (script: string): string[] => {
      const variables = new Set<string>();
      const regex = /\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g;
      let match;
      while ((match = regex.exec(script)) !== null) {
        variables.add(match[1]);
      }
      return Array.from(variables);
    };

    // Replace variables in script with values
    const replaceVariables = (script: string, values: Record<string, string>): string => {
      return script.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_match, varName) => {
        return values[varName] ?? _match;
      });
    };

    const handleExecuteClick = (snippet: SnippetRecord) => {
      const variables = parseVariables(snippet.script);
      if (variables.length > 0) {
        // Open dialog to enter variable values
        setExecutingSnippet(snippet);
        const initialValues: Record<string, string> = {};
        variables.forEach(v => {
          // Try to get default value from stored variables
          try {
            const storedVars = snippet.variables ? JSON.parse(snippet.variables) : [];
            const varDef = storedVars.find((v2: { name: string; defaultValue?: string }) => v2.name === v);
            if (varDef?.defaultValue) {
              initialValues[v] = varDef.defaultValue;
            }
          } catch { /* ignore */ }
        });
        setVariableValues(initialValues);
        setIsExecuteDialogOpen(true);
      } else {
        // No variables, execute directly
        handleExecute(snippet.script);
      }
    };

    const handleExecuteWithVariables = () => {
      if (!executingSnippet) return;
      const finalScript = replaceVariables(executingSnippet.script, variableValues);
      handleExecute(finalScript);
      setIsExecuteDialogOpen(false);
      setExecutingSnippet(null);
      setVariableValues({});
    };

    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Snippets Manager</DialogTitle>
          </DialogHeader>

          <div className="flex gap-4 flex-1 min-h-0">
            {/* Sidebar - Packages */}
            <div className="w-48 border-r pr-4">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium text-sm">Packages</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setIsPackageDialogOpen(true)}
                >
                  <FolderPlus className="h-4 w-4" />
                </Button>
              </div>
              <div className="space-y-1">
                <Button
                  variant="ghost"
                  className={`w-full justify-start px-2 py-1 h-auto text-sm ${
                    selectedPackage === null
                      ? "bg-secondary"
                      : "hover:bg-secondary/60"
                  }`}
                  onClick={() => setSelectedPackage(null)}
                >
                  All Snippets
                </Button>
                {packages.map((pkg) => (
                  <div
                    key={pkg.id}
                    className={`group flex items-center justify-between w-full text-left px-2 py-1 rounded text-sm ${
                      selectedPackage === pkg.id
                        ? "bg-secondary"
                        : "hover:bg-secondary/60"
                    }`}
                  >
                    <Button
                      variant="ghost"
                      className="flex-1 justify-start truncate px-0"
                      onClick={() => setSelectedPackage(pkg.id)}
                    >
                      {pkg.name}
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-5 opacity-0 group-hover:opacity-100"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete Package</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you sure you want to delete "{pkg.name}"? All snippets in this package will be moved to uncategorized.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => deleteSnippetPackage(pkg.id).then(loadData)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ))}
              </div>
            </div>

            {/* Main Content - Snippets */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex items-center gap-2 mb-4">
                <div className="relative flex-1">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search snippets..."
                    className="pl-8"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
                <Button onClick={() => setIsCreateDialogOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  New Snippet
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2">
                {filteredSnippets.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    No snippets found
                  </div>
                ) : (
                  filteredSnippets.map((snippet) => (
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
                            {snippet.script.length > 200 && "..."}
                          </pre>
                        </div>
                        <div className="flex items-center gap-1 ml-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleExecuteClick(snippet)}
                            title="Execute"
                          >
                            <Play className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setEditingSnippet(snippet)}
                            title="Edit"
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Delete"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Snippet</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete "{snippet.name}"? This action cannot be undone.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={() => handleDelete(snippet.id)}>Delete</AlertDialogAction>
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
          </div>
        </DialogContent>

        {/* Create Snippet Dialog */}
        <Dialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Snippet</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({ ...formData, name: e.target.value })
                  }
                  placeholder="My Snippet"
                />
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Input
                  id="description"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                  placeholder="Optional description"
                />
              </div>
              <div>
                <Label htmlFor="script">Script</Label>
                <Textarea
                  id="script"
                  value={formData.script}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setFormData({ ...formData, script: e.target.value })
                  }
                  placeholder="echo 'Hello World'"
                  className="font-mono h-32"
                />
              </div>
              <div>
                <Label htmlFor="package">Package</Label>
                <Select value={formData.packageId} onValueChange={(v) => setFormData({ ...formData, packageId: v })}>
                  <SelectTrigger id="package">
                    <SelectValue placeholder="No Package" />
                  </SelectTrigger>
                  <SelectContent>
                    {packages.map((pkg) => (
                      <SelectItem key={pkg.id} value={pkg.id}>{pkg.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setIsCreateDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button onClick={handleCreate}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Edit Snippet Dialog */}
        <Dialog open={!!editingSnippet} onOpenChange={() => setEditingSnippet(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Snippet</DialogTitle>
            </DialogHeader>
            {editingSnippet && (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="edit-name">Name</Label>
                  <Input
                    id="edit-name"
                    value={editingSnippet.name}
                    onChange={(e) =>
                      setEditingSnippet({
                        ...editingSnippet,
                        name: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="edit-description">Description</Label>
                  <Input
                    id="edit-description"
                    value={editingSnippet.description || ""}
                    onChange={(e) =>
                      setEditingSnippet({
                        ...editingSnippet,
                        description: e.target.value,
                      })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor="edit-script">Script</Label>
                  <Textarea
                    id="edit-script"
                    value={editingSnippet.script}
                    onChange={(e) =>
                      setEditingSnippet({
                        ...editingSnippet,
                        script: e.target.value,
                      })
                    }
                    className="font-mono h-32"
                  />
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditingSnippet(null)}>
                Cancel
              </Button>
              <Button onClick={handleUpdate}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Execute Snippet with Variables Dialog */}
        <Dialog open={isExecuteDialogOpen} onOpenChange={setIsExecuteDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Execute Snippet - Set Variables</DialogTitle>
            </DialogHeader>
            {executingSnippet && (
              <div className="space-y-4">
                <div className="text-sm text-muted-foreground">
                  Enter values for the variables in this snippet:
                </div>
                <div className="text-xs font-mono bg-muted p-2 rounded">
                  {executingSnippet.script}
                </div>
                <div className="space-y-3">
                  {parseVariables(executingSnippet.script).map((varName) => (
                    <div key={varName}>
                      <Label htmlFor={`var-${varName}`}>{varName}</Label>
                      <Input
                        id={`var-${varName}`}
                        value={variableValues[varName] || ""}
                        onChange={(e) =>
                          setVariableValues({ ...variableValues, [varName]: e.target.value })
                        }
                        placeholder={`Enter ${varName}`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsExecuteDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleExecuteWithVariables}>
                <Play className="h-4 w-4 mr-1" />
                Execute
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Create Package Dialog */}
        <Dialog open={isPackageDialogOpen} onOpenChange={setIsPackageDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Package</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="package-name">Package Name</Label>
                <Input
                  id="package-name"
                  value={newPackageName}
                  onChange={(e) => setNewPackageName(e.target.value)}
                  placeholder="My Package"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsPackageDialogOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreatePackage}>Create</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Dialog>
    );
  }
);

export default SnippetManager;
