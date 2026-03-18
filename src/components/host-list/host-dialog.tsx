import React, { useState, useEffect } from "react";
import { useInjectable } from "@/hooks/use-di";
import { HostStore } from "@/store/host";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Host, AuthType } from "@/types";
import PortForwardDialog from "@/components/port-forward";
import { Network } from "lucide-react";

interface HostDialogProps {
  open: boolean;
  host?: Host | null;
  onClose: () => void;
}

const defaultHost: Omit<Host, "id" | "createdAt" | "updatedAt"> = {
  name: "",
  hostname: "",
  port: 22,
  username: "",
  authType: "password",
  password: "",
  privateKey: "",
  groupId: undefined,
  isFavorite: false,
  color: undefined,
  tags: [],
  portForwards: [],
  startupCommand: undefined,
  environment: undefined,
};

export const HostDialog: React.FC<HostDialogProps> = ({ open, host, onClose }) => {
  const hostStore = useInjectable(HostStore);
  const [form, setForm] = useState(defaultHost);
  const [saving, setSaving] = useState(false);
  const [portForwardDialogOpen, setPortForwardDialogOpen] = useState(false);

  useEffect(() => {
    if (host) {
      setForm({
        name: host.name,
        hostname: host.hostname,
        port: host.port,
        username: host.username,
        authType: host.authType,
        password: host.password || "",
        privateKey: host.privateKey || "",
        groupId: host.groupId,
        isFavorite: host.isFavorite,
        color: host.color,
        tags: host.tags,
        portForwards: host.portForwards,
        startupCommand: host.startupCommand,
        environment: host.environment,
      });
    } else {
      setForm(defaultHost);
    }
  }, [host, open]);

  const handleSubmit = async () => {
    if (!form.name || !form.hostname || !form.username) return;
    setSaving(true);
    try {
      if (host) {
        await hostStore.updateHost(host.id, form);
      } else {
        await hostStore.addHost(form);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (host && confirm("Are you sure you want to delete this host?")) {
      await hostStore.deleteHost(host.id);
      onClose();
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[500px] max-h-[80vh] bg-background rounded-lg shadow-xl overflow-hidden flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">{host ? "Edit Host" : "New Host"}</h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="My Server"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Hostname</label>
              <Input
                value={form.hostname}
                onChange={(e) => setForm({ ...form, hostname: e.target.value })}
                placeholder="192.168.1.1 or example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Port</label>
              <Input
                type="number"
                value={form.port}
                onChange={(e) => setForm({ ...form, port: parseInt(e.target.value) || 22 })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Username</label>
              <Input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="root"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Group</label>
              <select
                className="w-full px-3 py-1.5 text-sm bg-background border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.groupId || ""}
                onChange={(e) => setForm({ ...form, groupId: e.target.value || undefined })}
              >
                <option value="">No Group</option>
                {hostStore.groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.name}</option>
                ))}
              </select>
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Authentication</label>
              <select
                className="w-full px-3 py-1.5 text-sm bg-background border rounded-md focus:outline-none focus:ring-1 focus:ring-primary"
                value={form.authType}
                onChange={(e) => setForm({ ...form, authType: e.target.value as AuthType })}
              >
                <option value="password">Password</option>
                <option value="key">SSH Key</option>
                <option value="agent">SSH Agent</option>
              </select>
            </div>

            {form.authType === "password" && (
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">Password</label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
            )}

            {form.authType === "key" && (
              <>
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Private Key</label>
                  <div className="flex gap-2">
                    <textarea
                      className="flex-1 px-3 py-2 text-sm bg-background border rounded-md focus:outline-none focus:ring-1 focus:ring-primary font-mono"
                      rows={5}
                      value={form.privateKey}
                      onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    />
                    <Button
                      variant="outline"
                      onClick={async () => {
                        // Use Tauri's dialog API to open file picker
                        try {
                          const { open } = await import('@tauri-apps/plugin-dialog');
                          const selected = await open({
                            multiple: false,
                            filters: [
                              { name: 'SSH Keys', extensions: ['pem', 'key', 'ppk', '*'] }
                            ]
                          });
                          if (selected) {
                            // Read the file content
                            const { readTextFile } = await import('@tauri-apps/plugin-fs');
                            const content = await readTextFile(selected as string);
                            setForm({ ...form, privateKey: content });
                          }
                        } catch (e) {
                          console.error("Failed to open file dialog:", e);
                          // Fallback: prompt user to enter path manually
                          const path = prompt("Enter private key file path:");
                          if (path) {
                            try {
                              const { readTextFile } = await import('@tauri-apps/plugin-fs');
                              const content = await readTextFile(path);
                              setForm({ ...form, privateKey: content });
                            } catch (err) {
                              console.error("Failed to read key file:", err);
                            }
                          }
                        }
                      }}
                    >
                      Browse
                    </Button>
                  </div>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium mb-1">Key Passphrase (optional)</label>
                  <Input
                    type="password"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    placeholder="••••••••"
                  />
                </div>
              </>
            )}

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Startup Command (optional)</label>
              <Input
                value={form.startupCommand}
                onChange={(e) => setForm({ ...form, startupCommand: e.target.value })}
                placeholder="ls -la"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-sm font-medium mb-1">Port Forwards</label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPortForwardDialogOpen(true)}
              >
                <Network className="h-4 w-4 mr-1" />
                Configure Port Forwards ({form.portForwards?.length || 0})
              </Button>
            </div>
          </div>
        </div>

        <div className="p-4 border-t flex justify-between">
          <div>
            {host && (
              <Button variant="destructive" onClick={handleDelete}>
                Delete
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || !form.name || !form.hostname || !form.username}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>

      <PortForwardDialog
        open={portForwardDialogOpen}
        onClose={() => setPortForwardDialogOpen(false)}
        portForwards={form.portForwards || []}
        onSave={(forwards) => setForm({ ...form, portForwards: forwards })}
      />
    </div>
  );
};
