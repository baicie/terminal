import { useState, useEffect } from "react";
import { observer } from "mobx-react-lite";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getAppSettings, saveAppSettings, select, executeQuery, type AppSettings } from "@/service/database";
import { exportDataToFile, previewImportData, type ExportData } from "@/service/sync";
import {
  Upload,
  Download,
  FileJson,
  RefreshCw,
  Check,
  AlertCircle,
  Merge,
  Replace,
  Shield,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type ImportStep = "idle" | "preview" | "importing" | "success" | "error";

interface ImportPreview {
  hosts: number;
  groups: number;
  snippets: number;
  snippetPackages: number;
  workspaces: number;
}

const SettingsDialog: React.FC<SettingsDialogProps> = observer(({ open, onClose }) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // Sync state
  const [importMode, setImportMode] = useState<"merge" | "replace">("merge");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importContent, setImportContent] = useState<string | null>(null);
  const [importStep, setImportStep] = useState<ImportStep>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (open) {
      loadSettings();
    }
  }, [open]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const loaded = await getAppSettings();
      setSettings(loaded);
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
    setLoading(false);
  };

  const handleSave = async () => {
    if (!settings) return;
    try {
      await saveAppSettings(settings);
      onClose();
    } catch (error) {
      console.error("Failed to save settings:", error);
    }
  };

  const updateSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    if (settings) {
      setSettings({ ...settings, [key]: value });
    }
  };

  // Sync functions
  const resetSyncState = () => {
    setImportStep("idle");
    setImportPreview(null);
    setImportContent(null);
    setErrorMessage(null);
    setImportMode("merge");
  };

  const handleExport = async () => {
    setExporting(true);
    setErrorMessage(null);

    try {
      const filePath = await exportDataToFile();
      if (filePath) {
        alert(`Exported successfully to:\n${filePath}`);
      }
    } catch (error) {
      console.error("Export failed:", error);
      setErrorMessage(`Export failed: ${error}`);
    } finally {
      setExporting(false);
    }
  };

  const handleSelectImportFile = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [
          { name: "JSON Files", extensions: ["json"] },
          { name: "All Files", extensions: ["*"] },
        ],
      });

      if (selected) {
        const content = await readTextFile(selected);
        const preview = previewImportData(content);

        if (preview) {
          setImportContent(content);
          setImportPreview({
            hosts: preview.hosts?.length || 0,
            groups: preview.groups?.length || 0,
            snippets: preview.snippets?.length || 0,
            snippetPackages: preview.snippetPackages?.length || 0,
            workspaces: preview.workspaces?.length || 0,
          });
          setImportStep("preview");
        } else {
          setErrorMessage("Invalid export file format");
          setImportStep("error");
        }
      }
    } catch (error) {
      console.error("Failed to read file:", error);
      setErrorMessage(`Failed to read file: ${error}`);
      setImportStep("error");
    }
  };

  const handleImport = async () => {
    if (!importContent) return;

    setImportStep("importing");

    try {
      const data: ExportData = JSON.parse(importContent);

      // Import in order: groups first, then hosts, then snippets
      if (data.groups && data.groups.length > 0) {
        for (const group of data.groups as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            "SELECT id FROM groups WHERE id = ?",
            [group.id as string]
          );
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO groups (id, name, parent_id, color, inherit_settings, settings, "order") VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                group.id,
                group.name,
                group.parent_id,
                group.color,
                group.inherit_settings,
                group.settings,
                group.order,
              ]
            );
          } else if (importMode === "replace") {
            await executeQuery(
              `UPDATE groups SET name = ?, parent_id = ?, color = ?, inherit_settings = ?, settings = ?, "order" = ? WHERE id = ?`,
              [
                group.name,
                group.parent_id,
                group.color,
                group.inherit_settings,
                group.settings,
                group.order,
                group.id,
              ]
            );
          }
        }
      }

      if (data.hosts && data.hosts.length > 0) {
        for (const host of data.hosts as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            "SELECT id FROM hosts WHERE id = ?",
            [host.id as string]
          );
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO hosts (id, name, hostname, port, username, auth_type, password, private_key, group_id, is_favorite, color, tags, port_forwards, startup_command, environment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                host.id,
                host.name,
                host.hostname,
                host.port,
                host.username,
                host.auth_type,
                host.password,
                host.private_key,
                host.group_id,
                host.is_favorite,
                host.color,
                host.tags,
                host.port_forwards,
                host.startup_command,
                host.environment,
                host.created_at,
                host.updated_at,
              ]
            );
          } else if (importMode === "replace") {
            await executeQuery(
              `UPDATE hosts SET name = ?, hostname = ?, port = ?, username = ?, auth_type = ?, password = ?, private_key = ?, group_id = ?, is_favorite = ?, color = ?, tags = ?, port_forwards = ?, startup_command = ?, environment = ?, updated_at = ? WHERE id = ?`,
              [
                host.name,
                host.hostname,
                host.port,
                host.username,
                host.auth_type,
                host.password,
                host.private_key,
                host.group_id,
                host.is_favorite,
                host.color,
                host.tags,
                host.port_forwards,
                host.startup_command,
                host.environment,
                Date.now(),
                host.id,
              ]
            );
          }
        }
      }

      if (data.snippets && data.snippets.length > 0) {
        for (const snippet of data.snippets as Record<string, unknown>[]) {
          const existing = await select<{ id: string }>(
            "SELECT id FROM snippets WHERE id = ?",
            [snippet.id as string]
          );
          if (existing.length === 0) {
            await executeQuery(
              `INSERT INTO snippets (id, name, description, script, package_id, tags, variables) VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [
                snippet.id,
                snippet.name,
                snippet.description,
                snippet.script,
                snippet.package_id,
                snippet.tags,
                snippet.variables,
              ]
            );
          } else if (importMode === "replace") {
            await executeQuery(
              `UPDATE snippets SET name = ?, description = ?, script = ?, package_id = ?, tags = ?, variables = ? WHERE id = ?`,
              [
                snippet.name,
                snippet.description,
                snippet.script,
                snippet.package_id,
                snippet.tags,
                snippet.variables,
                snippet.id,
              ]
            );
          }
        }
      }

      setImportStep("success");
      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (error) {
      console.error("Import failed:", error);
      setErrorMessage(`Import failed: ${error}`);
      setImportStep("error");
    }
  };

  if (loading || !settings) {
    return (
      <Dialog open={open} onOpenChange={onClose}>
        <DialogContent>
          <div className="py-8 text-center">Loading...</div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="appearance" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="sync">Sync</TabsTrigger>
          </TabsList>

          <TabsContent value="appearance" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="theme">Theme</Label>
              <Select
                value={settings.theme}
                onValueChange={(value) => updateSetting("theme", value as "light" | "dark" | "system")}
              >
                <SelectTrigger id="theme">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">Light</SelectItem>
                  <SelectItem value="dark">Dark</SelectItem>
                  <SelectItem value="system">System</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="language">Language</Label>
              <Select
                value={settings.language}
                onValueChange={(value: string) => updateSetting("language", value)}
              >
                <SelectTrigger id="language">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="cn">中文</SelectItem>
                  <SelectItem value="fr">Français</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </TabsContent>

          <TabsContent value="terminal" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="fontSize">Font Size</Label>
              <Input
                id="fontSize"
                type="number"
                min={8}
                max={32}
                value={settings.fontSize}
                onChange={(e) => updateSetting("fontSize", parseInt(e.target.value) || 14)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fontFamily">Font Family</Label>
              <Input
                id="fontFamily"
                value={settings.fontFamily}
                onChange={(e) => updateSetting("fontFamily", e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cursorStyle">Cursor Style</Label>
              <Select
                value={settings.cursorStyle}
                onValueChange={(value) => updateSetting("cursorStyle", value as "block" | "underline" | "bar")}
              >
                <SelectTrigger id="cursorStyle">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="block">Block</SelectItem>
                  <SelectItem value="underline">Underline</SelectItem>
                  <SelectItem value="bar">Bar</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="cursorBlink">Cursor Blink</Label>
              <input
                id="cursorBlink"
                type="checkbox"
                checked={settings.cursorBlink}
                onChange={(e) => updateSetting("cursorBlink", e.target.checked)}
                className="w-4 h-4"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="scrollback">Scrollback Lines</Label>
              <Input
                id="scrollback"
                type="number"
                min={1000}
                max={100000}
                value={settings.scrollback}
                onChange={(e) => updateSetting("scrollback", parseInt(e.target.value) || 10000)}
              />
            </div>
          </TabsContent>

          <TabsContent value="general" className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="copyOnSelect">Copy on Select</Label>
                <p className="text-sm text-muted-foreground">Automatically copy selection to clipboard</p>
              </div>
              <input
                id="copyOnSelect"
                type="checkbox"
                checked={settings.copyOnSelect}
                onChange={(e) => updateSetting("copyOnSelect", e.target.checked)}
                className="w-4 h-4"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="pasteOnMiddleClick">Paste on Middle Click</Label>
                <p className="text-sm text-muted-foreground">Paste clipboard content on middle mouse button click</p>
              </div>
              <input
                id="pasteOnMiddleClick"
                type="checkbox"
                checked={settings.pasteOnMiddleClick}
                onChange={(e) => updateSetting("pasteOnMiddleClick", e.target.checked)}
                className="w-4 h-4"
              />
            </div>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="allowProposedApi">Allow Proposed API</Label>
                <p className="text-sm text-muted-foreground">Enable xterm.js proposed API features</p>
              </div>
              <input
                id="allowProposedApi"
                type="checkbox"
                checked={settings.allowProposedApi}
                onChange={(e) => updateSetting("allowProposedApi", e.target.checked)}
                className="w-4 h-4"
              />
            </div>
          </TabsContent>

          <TabsContent value="sync" className="space-y-6 py-4">
            {/* Export Section */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Download className="h-4 w-4" />
                Export Data
              </h4>
              <p className="text-sm text-muted-foreground">
                Export all hosts, groups, snippets, and settings to a JSON file for backup or sync.
              </p>
              <Button
                variant="outline"
                onClick={handleExport}
                disabled={exporting}
                className="w-full"
              >
                {exporting ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Exporting...
                  </>
                ) : (
                  <>
                    <FileJson className="h-4 w-4 mr-2" />
                    Export to JSON File
                  </>
                )}
              </Button>
            </div>

            <div className="border-t" />

            {/* Import Section */}
            <div className="space-y-3">
              <h4 className="text-sm font-medium flex items-center gap-2">
                <Upload className="h-4 w-4" />
                Import Data
              </h4>

              {importStep === "idle" && (
                <>
                  <p className="text-sm text-muted-foreground">
                    Select an exported JSON file to import data.
                  </p>
                  <Button
                    variant="outline"
                    onClick={handleSelectImportFile}
                    className="w-full"
                  >
                    <FileJson className="h-4 w-4 mr-2" />
                    Select Import File
                  </Button>
                </>
              )}

              {importStep === "preview" && importPreview && (
                <div className="space-y-3">
                  <div className="p-3 bg-muted rounded-lg space-y-2">
                    <p className="text-sm font-medium">Import Preview:</p>
                    <ul className="text-sm text-muted-foreground space-y-1">
                      <li>
                        <Check className="h-3 w-3 inline mr-1 text-green-500" />
                        {importPreview.hosts} host(s)
                      </li>
                      <li>
                        <Check className="h-3 w-3 inline mr-1 text-green-500" />
                        {importPreview.groups} group(s)
                      </li>
                      <li>
                        <Check className="h-3 w-3 inline mr-1 text-green-500" />
                        {importPreview.snippets} snippet(s)
                      </li>
                    </ul>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm">Import Mode</Label>
                    <div className="flex gap-2">
                      <Button
                        variant={importMode === "merge" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setImportMode("merge")}
                        className="flex-1"
                      >
                        <Merge className="h-4 w-4 mr-1" />
                        Merge
                      </Button>
                      <Button
                        variant={importMode === "replace" ? "default" : "outline"}
                        size="sm"
                        onClick={() => setImportMode("replace")}
                        className="flex-1"
                      >
                        <Replace className="h-4 w-4 mr-1" />
                        Replace
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {importMode === "merge"
                        ? "New items will be added, existing items will be kept."
                        : "Existing items with the same ID will be overwritten."}
                    </p>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={resetSyncState}
                      className="flex-1"
                    >
                      Cancel
                    </Button>
                    <Button onClick={handleImport} className="flex-1">
                      <Upload className="h-4 w-4 mr-1" />
                      Import
                    </Button>
                  </div>
                </div>
              )}

              {importStep === "importing" && (
                <div className="text-center py-4">
                  <RefreshCw className="h-8 w-8 mx-auto animate-spin text-primary" />
                  <p className="mt-2 text-sm">Importing data...</p>
                </div>
              )}

              {importStep === "success" && (
                <div className="text-center py-4">
                  <div className="h-8 w-8 mx-auto rounded-full bg-green-100 flex items-center justify-center">
                    <Check className="h-5 w-5 text-green-600" />
                  </div>
                  <p className="mt-2 text-sm">Import successful!</p>
                </div>
              )}

              {importStep === "error" && (
                <div className="space-y-3">
                  <div className="p-3 bg-destructive/10 rounded-lg flex items-start gap-2">
                    <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                    <p className="text-sm text-destructive">{errorMessage}</p>
                  </div>
                  <Button variant="outline" onClick={resetSyncState} className="w-full">
                    Try Again
                  </Button>
                </div>
              )}
            </div>

            <div className="p-3 bg-muted/50 rounded-lg flex items-start gap-2">
              <Shield className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">
                Data is exported as plain JSON. Sensitive information like passwords
                may be included depending on your settings. Keep your export files secure.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
});

export default SettingsDialog;
