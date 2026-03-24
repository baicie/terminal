import React, { useState, useEffect } from 'react'
import { useInjectable } from '@/hooks/use-di'
import { HostStore } from '@/store/host'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Host, AuthType } from '@/types'
import PortForwardDialog from '@/components/port-forward'
import { Network, Plus, Trash2 } from 'lucide-react'

interface HostDialogProps {
  open: boolean
  host?: Host | null
  onClose: () => void
}

const defaultHost: Omit<Host, 'id' | 'createdAt' | 'updatedAt'> = {
  name: '',
  hostname: '',
  port: 22,
  username: '',
  authType: 'password',
  password: '',
  privateKey: '',
  groupId: undefined,
  isFavorite: false,
  color: undefined,
  tags: [],
  portForwards: [],
  startupCommand: undefined,
  environment: undefined,
  jumpHostId: undefined,
  jumpHostAuthType: undefined,
}

export const HostDialog: React.FC<HostDialogProps> = ({
  open,
  host,
  onClose,
}) => {
  const hostStore = useInjectable(HostStore)
  const [form, setForm] = useState(defaultHost)
  const [saving, setSaving] = useState(false)
  const [portForwardDialogOpen, setPortForwardDialogOpen] = useState(false)
  const [environmentDialogOpen, setEnvironmentDialogOpen] = useState(false)
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>(
    [],
  )

  useEffect(() => {
    if (host) {
      setForm({
        name: host.name,
        hostname: host.hostname,
        port: host.port,
        username: host.username,
        authType: host.authType,
        password: host.password || '',
        privateKey: host.privateKey || '',
        groupId: host.groupId,
        isFavorite: host.isFavorite,
        color: host.color,
        tags: host.tags,
        portForwards: host.portForwards,
        startupCommand: host.startupCommand,
        environment: host.environment,
        jumpHostId: host.jumpHostId,
        jumpHostAuthType: host.jumpHostAuthType,
      })
      // Sync environment variables
      if (host.environment) {
        setEnvVars(
          Object.entries(host.environment).map(([key, value]) => ({
            key,
            value,
          })),
        )
      } else {
        setEnvVars([])
      }
    } else {
      setForm(defaultHost)
      setEnvVars([])
    }
  }, [host, open])

  const handleSubmit = async () => {
    if (!form.name || !form.hostname || !form.username) return
    setSaving(true)
    try {
      if (host) {
        await hostStore.updateHost(host.id, form)
      } else {
        await hostStore.addHost(form)
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const handleDelete = async () => {
    if (host) {
      await hostStore.deleteHost(host.id)
      setDeleteDialogOpen(false)
      onClose()
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[500px] max-h-[80vh] bg-background rounded-lg shadow-xl overflow-hidden flex flex-col">
        <div className="p-4 border-b">
          <h2 className="text-lg font-semibold">
            {host ? 'Edit Host' : 'New Host'}
          </h2>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Label htmlFor="name" className="text-sm font-medium mb-1 block">
                Name
              </Label>
              <Input
                id="name"
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="My Server"
              />
            </div>

            <div>
              <Label
                htmlFor="hostname"
                className="text-sm font-medium mb-1 block"
              >
                Hostname
              </Label>
              <Input
                id="hostname"
                value={form.hostname}
                onChange={e => setForm({ ...form, hostname: e.target.value })}
                placeholder="192.168.1.1 or example.com"
              />
            </div>

            <div>
              <Label htmlFor="port" className="text-sm font-medium mb-1 block">
                Port
              </Label>
              <Input
                id="port"
                type="number"
                value={form.port}
                onChange={e =>
                  setForm({ ...form, port: parseInt(e.target.value) || 22 })
                }
              />
            </div>

            <div>
              <Label
                htmlFor="username"
                className="text-sm font-medium mb-1 block"
              >
                Username
              </Label>
              <Input
                id="username"
                value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })}
                placeholder="root"
              />
            </div>

            <div>
              <Label htmlFor="group" className="text-sm font-medium mb-1 block">
                Group
              </Label>
              <Select
                value={form.groupId || ''}
                onValueChange={v =>
                  setForm({ ...form, groupId: v || undefined })
                }
              >
                <SelectTrigger id="group">
                  <SelectValue placeholder="No Group" />
                </SelectTrigger>
                <SelectContent>
                  {hostStore.groups.map(g => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Jump Host Selector */}
            <div className="col-span-2">
              <Label
                htmlFor="jumpHost"
                className="text-sm font-medium mb-1 flex items-center gap-1"
              >
                <Network className="w-3.5 h-3.5" />
                Jump Host (Bastion)
              </Label>
              <Select
                value={form.jumpHostId || ''}
                onValueChange={v =>
                  setForm({ ...form, jumpHostId: v || undefined })
                }
              >
                <SelectTrigger id="jumpHost">
                  <SelectValue placeholder="Direct Connection" />
                </SelectTrigger>
                <SelectContent>
                  {hostStore.hosts
                    .filter(h => h.id !== host?.id)
                    .map(h => (
                      <SelectItem key={h.id} value={h.id}>
                        {h.name} ({h.username}@{h.hostname})
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground mt-1">
                Connect through a bastion/jump server
              </p>
            </div>

            {/* Jump Host Auth Override (optional) */}
            {form.jumpHostId && (
              <div className="col-span-2">
                <Label
                  htmlFor="jumpHostAuth"
                  className="text-sm font-medium mb-1 block"
                >
                  Jump Host Auth
                </Label>
                <Select
                  value={form.jumpHostAuthType || ''}
                  onValueChange={v =>
                    setForm({
                      ...form,
                      jumpHostAuthType: (v as AuthType) || undefined,
                    })
                  }
                >
                  <SelectTrigger id="jumpHostAuth">
                    <SelectValue placeholder="Use Default Auth" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="password">Password</SelectItem>
                    <SelectItem value="key">SSH Key</SelectItem>
                    <SelectItem value="agent">SSH Agent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="col-span-2">
              <Label
                htmlFor="authType"
                className="text-sm font-medium mb-1 block"
              >
                Authentication
              </Label>
              <Select
                value={form.authType}
                onValueChange={v =>
                  setForm({ ...form, authType: v as AuthType })
                }
              >
                <SelectTrigger id="authType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="password">Password</SelectItem>
                  <SelectItem value="key">SSH Key</SelectItem>
                  <SelectItem value="agent">SSH Agent</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.authType === 'password' && (
              <div className="col-span-2">
                <Label
                  htmlFor="password"
                  className="text-sm font-medium mb-1 block"
                >
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                />
              </div>
            )}

            {form.authType === 'key' && (
              <>
                <div className="col-span-2">
                  <Label
                    htmlFor="privateKey"
                    className="text-sm font-medium mb-1 block"
                  >
                    Private Key
                  </Label>
                  <div className="flex gap-2">
                    <Textarea
                      id="privateKey"
                      className="flex-1 font-mono min-h-[120px]"
                      value={form.privateKey}
                      onChange={e =>
                        setForm({ ...form, privateKey: e.target.value })
                      }
                      placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
                    />
                    <Button
                      variant="outline"
                      onClick={async () => {
                        try {
                          const { open } =
                            await import('@tauri-apps/plugin-dialog')
                          const selected = await open({
                            multiple: false,
                            filters: [
                              {
                                name: 'SSH Keys',
                                extensions: ['pem', 'key', 'ppk', '*'],
                              },
                            ],
                          })
                          if (selected) {
                            const { readTextFile } =
                              await import('@tauri-apps/plugin-fs')
                            const content = await readTextFile(
                              selected as string,
                            )
                            setForm({ ...form, privateKey: content })
                          }
                        } catch (e) {
                          console.error('Failed to open file dialog:', e)
                        }
                      }}
                    >
                      Browse
                    </Button>
                  </div>
                </div>
                <div className="col-span-2">
                  <Label
                    htmlFor="passphrase"
                    className="text-sm font-medium mb-1 block"
                  >
                    Key Passphrase (optional)
                  </Label>
                  <Input
                    id="passphrase"
                    type="password"
                    value={form.password}
                    onChange={e =>
                      setForm({ ...form, password: e.target.value })
                    }
                    placeholder="••••••••"
                  />
                </div>
              </>
            )}

            <div className="col-span-2">
              <Label
                htmlFor="startupCommand"
                className="text-sm font-medium mb-1 block"
              >
                Startup Command (optional)
              </Label>
              <Input
                id="startupCommand"
                value={form.startupCommand}
                onChange={e =>
                  setForm({ ...form, startupCommand: e.target.value })
                }
                placeholder="ls -la"
              />
            </div>

            <div className="col-span-2">
              <Label className="text-sm font-medium mb-1 block">
                Environment Variables
              </Label>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEnvironmentDialogOpen(true)}
              >
                <Network className="h-4 w-4 mr-1" />
                Configure Environment (
                {Object.keys(form.environment || {}).length})
              </Button>
            </div>

            <div className="col-span-2">
              <Label
                htmlFor="portForwards"
                className="text-sm font-medium mb-1 block"
              >
                Port Forwards
              </Label>
              <Button
                id="portForwards"
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
              <AlertDialog
                open={deleteDialogOpen}
                onOpenChange={setDeleteDialogOpen}
              >
                <AlertDialogTrigger asChild>
                  <Button variant="destructive">Delete</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Host</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete "{host.name}"? This action
                      cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={
                saving || !form.name || !form.hostname || !form.username
              }
            >
              {saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>

      <PortForwardDialog
        open={portForwardDialogOpen}
        onClose={() => setPortForwardDialogOpen(false)}
        portForwards={form.portForwards || []}
        onSave={forwards => setForm({ ...form, portForwards: forwards })}
      />

      {/* Environment Variables Dialog */}
      <Dialog
        open={environmentDialogOpen}
        onOpenChange={setEnvironmentDialogOpen}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Environment Variables</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 max-h-80 overflow-y-auto py-2">
            {envVars.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No environment variables configured. Click "Add Variable" to add
                one.
              </p>
            ) : (
              envVars.map((env, index) => (
                <div key={index} className="flex gap-2 items-center">
                  <Input
                    placeholder="KEY"
                    value={env.key}
                    onChange={e => {
                      const updated = [...envVars]
                      updated[index].key = e.target.value
                        .toUpperCase()
                        .replace(/[^A-Z0-9_]/g, '')
                      setEnvVars(updated)
                    }}
                    className="flex-1 font-mono text-sm"
                  />
                  <span className="text-muted-foreground">=</span>
                  <Input
                    placeholder="value"
                    value={env.value}
                    onChange={e => {
                      const updated = [...envVars]
                      updated[index].value = e.target.value
                      setEnvVars(updated)
                    }}
                    className="flex-1 font-mono text-sm"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-destructive"
                    onClick={() =>
                      setEnvVars(envVars.filter((_, i) => i !== index))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setEnvVars([...envVars, { key: '', value: '' }])}
            >
              <Plus className="size-4 mr-1" data-icon="inline-start" />
              Add Variable
            </Button>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEnvironmentDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                // Convert array to Record<string, string>
                const envRecord: Record<string, string> = {}
                for (const { key, value } of envVars) {
                  if (key.trim()) {
                    envRecord[key.trim()] = value
                  }
                }
                setForm({
                  ...form,
                  environment:
                    Object.keys(envRecord).length > 0 ? envRecord : undefined,
                })
                setEnvironmentDialogOpen(false)
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
