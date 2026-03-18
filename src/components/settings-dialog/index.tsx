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
import { getAppSettings, saveAppSettings, type AppSettings } from "@/service/database";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

const SettingsDialog: React.FC<SettingsDialogProps> = observer(({ open, onClose }) => {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

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
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="terminal">Terminal</TabsTrigger>
            <TabsTrigger value="general">General</TabsTrigger>
          </TabsList>

          <TabsContent value="appearance" className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="theme">Theme</Label>
              <Select
                value={settings.theme}
                onValueChange={(value) => updateSetting("theme", value as "light" | "dark" | "system")}
              >
                <SelectTrigger>
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
                <SelectTrigger>
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
                <SelectTrigger>
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
