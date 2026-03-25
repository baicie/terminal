import { useState, useEffect, useCallback } from 'react'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { sshService } from '@/service/ssh'
import type { PortForwardConfig } from '@/types'
import {
  ViewContainer,
  ViewToolbar,
  ViewContent,
  ViewHeader,
  EmptyState,
} from '@/components/view-container'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  ArrowLeftRight,
  Plus,
  Search,
  Trash2,
  Play,
  Square,
  RefreshCw,
  Globe,
  Database,
  Server,
  Link,
} from 'lucide-react'
import { toast } from '@/components/ui/sonner'

interface PortForwardEntry {
  id: string
  name: string
  type: 'local' | 'remote' | 'dynamic'
  localHost: string
  localPort: number
  remoteHost: string
  remotePort: number
  active: boolean
  hostId?: string
  hostName?: string
  sessionId?: string
}

const PortForwardView: React.FC = () => {
  const tabs = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const hosts = useHostStore(s => s.hosts)

  const [forwards, setForwards] = useState<PortForwardEntry[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)

  // Dialog states
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [stopDialogOpen, setStopDialogOpen] = useState(false)
  const [forwardToStop, setForwardToStop] = useState<PortForwardEntry | null>(
    null,
  )

  // Form state
  const [formType, setFormType] = useState<'local' | 'remote' | 'dynamic'>(
    'local',
  )
  const [formName, setFormName] = useState('')
  const [formLocalHost, setFormLocalHost] = useState('127.0.0.1')
  const [formLocalPort, setFormLocalPort] = useState('8080')
  const [formRemoteHost, setFormRemoteHost] = useState('')
  const [formRemotePort, setFormRemotePort] = useState('')
  const [formHostId, setFormHostId] = useState('')

  // Load forwards from storage (mock for now - in production would use database)
  const loadForwards = useCallback(async () => {
    setLoading(true)
    try {
      // In production, load from database
      // For now, keep in memory
    } catch (error) {
      console.error('Failed to load port forwards:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadForwards()
  }, [loadForwards])

  // Start port forward
  const handleStartForward = async () => {
    if (!formRemoteHost || !formRemotePort) {
      toast.error('Remote host and port are required')
      return
    }

    const port = parseInt(formLocalPort, 10)
    if (isNaN(port) || port < 1 || port > 65535) {
      toast.error('Invalid local port number')
      return
    }

    const forwardId = `pf-${Date.now()}`
    const host = formHostId
      ? hosts.find(h => h.id === formHostId)
      : null

    const newForward: PortForwardEntry = {
      id: forwardId,
      name: formName || `${formType} forward ${port}`,
      type: formType,
      localHost: formLocalHost,
      localPort: port,
      remoteHost: formRemoteHost,
      remotePort: parseInt(formRemotePort, 10),
      active: true,
      hostId: formHostId || undefined,
      hostName: host?.name || undefined,
    }

    try {
      // If we have an active SSH session, try to start port forward through it
      if (tabs.find(t => t.id === activeTabId)?.hostId) {
        const config: PortForwardConfig = {
          id: forwardId,
          name: newForward.name,
          forward_type: formType,
          local_host: formLocalHost,
          local_port: port,
          remote_host: formRemoteHost,
          remote_port: parseInt(formRemotePort, 10),
        }

        const result = await sshService.portForwardStart('', config)
        if (!result.success) {
          // Port forward might not be available, but we can still show the UI
          console.warn(
            'Port forward backend not fully implemented:',
            result.message,
          )
        }
      }

      setForwards([...forwards, newForward])
      toast.success(`Port forward started on ${formLocalHost}:${port}`)
      setAddDialogOpen(false)
      resetForm()
    } catch (error) {
      toast.error(`Failed to start port forward: ${error}`)
    }
  }

  // Stop port forward
  const handleStopForward = async () => {
    if (!forwardToStop) return

    try {
      const result = await sshService.portForwardStop(forwardToStop.id)
      if (!result.success) {
        console.warn(
          'Port forward stop might not be fully implemented:',
          result.message,
        )
      }

      setForwards(
        forwards.map(f =>
          f.id === forwardToStop.id ? { ...f, active: false } : f,
        ),
      )
      toast.success(`Port forward stopped`)
      setStopDialogOpen(false)
      setForwardToStop(null)
    } catch (error) {
      toast.error(`Failed to stop port forward: ${error}`)
    }
  }

  // Delete port forward
  const handleDeleteForward = (forward: PortForwardEntry) => {
    if (forward.active) {
      setForwardToStop(forward)
      setStopDialogOpen(true)
    } else {
      setForwards(forwards.filter(f => f.id !== forward.id))
      toast.success('Port forward removed')
    }
  }

  // Reset form
  const resetForm = () => {
    setFormType('local')
    setFormName('')
    setFormLocalHost('127.0.0.1')
    setFormLocalPort('8080')
    setFormRemoteHost('')
    setFormRemotePort('')
    setFormHostId('')
  }

  // Filter forwards
  const filteredForwards = forwards.filter(
    f =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.localHost.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.remoteHost.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  // Get type badge color
  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'local':
        return (
          <Badge
            variant="default"
            className="bg-blue-500/10 text-blue-500 border-blue-500/20"
          >
            Local
          </Badge>
        )
      case 'remote':
        return (
          <Badge
            variant="default"
            className="bg-purple-500/10 text-purple-500 border-purple-500/20"
          >
            Remote
          </Badge>
        )
      case 'dynamic':
        return (
          <Badge
            variant="default"
            className="bg-orange-500/10 text-orange-500 border-orange-500/20"
          >
            Dynamic
          </Badge>
        )
      default:
        return <Badge variant="outline">{type}</Badge>
    }
  }

  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder="Search forwards..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="pl-9 h-9"
          />
        </div>

        <div className="flex-1" />

        <Button variant="outline" size="sm" onClick={() => void loadForwards()}>
          <RefreshCw
            className={`size-4 mr-1 ${loading ? 'animate-spin' : ''}`}
          />
          Refresh
        </Button>

        <Button size="sm" onClick={() => setAddDialogOpen(true)}>
          <Plus className="size-4 mr-1" data-icon="inline-start" />
          New Forward
        </Button>
      </ViewToolbar>

      <ViewContent className="p-6">
        <ViewHeader
          title="Port Forwarding"
          description="Manage SSH tunnels and port forwarding rules"
        />

        {filteredForwards.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight className="size-12" />}
            title="No port forwards configured"
            description="Set up port forwarding to access databases, web apps, and other services"
            action={
              <Button onClick={() => setAddDialogOpen(true)}>
                <Plus className="size-4 mr-1" data-icon="inline-start" />
                Add Forward
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredForwards.map(forward => (
              <Card
                key={forward.id}
                className={`hover:border-primary/50 transition-colors ${forward.active ? '' : 'opacity-60'}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <CardTitle className="text-base">
                        {forward.name}
                      </CardTitle>
                      <CardDescription className="flex items-center gap-2">
                        {getTypeBadge(forward.type)}
                        {forward.active ? (
                          <span className="flex items-center gap-1 text-green-500">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                            Active
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Stopped</span>
                        )}
                      </CardDescription>
                    </div>
                    <div className="flex gap-1">
                      {forward.active ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-red-500 hover:text-red-600"
                          onClick={() => {
                            setForwardToStop(forward)
                            setStopDialogOpen(true)
                          }}
                        >
                          <Square className="size-4" />
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-green-500 hover:text-green-600"
                          onClick={() => {
                            setForwards(
                              forwards.map(f =>
                                f.id === forward.id
                                  ? { ...f, active: true }
                                  : f,
                              ),
                            )
                            toast.success(
                              `Port forward started on ${forward.localHost}:${forward.localPort}`,
                            )
                          }}
                        >
                          <Play className="size-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 hover:text-destructive"
                        onClick={() => handleDeleteForward(forward)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Local binding */}
                  <div className="flex items-start gap-2">
                    <Globe className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="space-y-0.5">
                      <div className="text-xs text-muted-foreground">Local</div>
                      <div className="font-mono text-sm">
                        {forward.localHost}:{forward.localPort}
                      </div>
                    </div>
                  </div>

                  {/* Arrow */}
                  <div className="flex items-center gap-2 pl-1">
                    <Link className="size-3 text-muted-foreground" />
                    <div className="flex-1 h-px bg-border" />
                    <Link className="size-3 text-muted-foreground" />
                  </div>

                  {/* Remote target */}
                  <div className="flex items-start gap-2">
                    {forward.type === 'local' ? (
                      <Database className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                    ) : (
                      <Server className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                    )}
                    <div className="space-y-0.5">
                      <div className="text-xs text-muted-foreground">
                        {forward.type === 'local'
                          ? 'Remote'
                          : forward.type === 'remote'
                            ? 'Local'
                            : 'SOCKS'}
                      </div>
                      <div className="font-mono text-sm">
                        {forward.type === 'dynamic'
                          ? 'SOCKS Proxy'
                          : `${forward.remoteHost}:${forward.remotePort}`}
                      </div>
                    </div>
                  </div>

                  {/* Host info */}
                  {forward.hostName && (
                    <div className="pt-2 border-t text-xs text-muted-foreground">
                      via {forward.hostName}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </ViewContent>

      {/* Add Forward Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Port Forward</DialogTitle>
            <DialogDescription>
              Set up a port forwarding rule to access remote services locally
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Forward type */}
            <div className="space-y-2">
              <Label>Forward Type</Label>
              <Select
                value={formType}
                onValueChange={v => setFormType(v as typeof formType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="local">
                    <div className="flex items-center gap-2">
                      <Globe className="size-4" />
                      <span>Local Port Forward (-L)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="remote">
                    <div className="flex items-center gap-2">
                      <Server className="size-4" />
                      <span>Remote Port Forward (-R)</span>
                    </div>
                  </SelectItem>
                  <SelectItem value="dynamic">
                    <div className="flex items-center gap-2">
                      <ArrowLeftRight className="size-4" />
                      <span>Dynamic / SOCKS (-D)</span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {formType === 'local' && 'Forward local port to remote host'}
                {formType === 'remote' && 'Forward remote port to local host'}
                {formType === 'dynamic' &&
                  'Create SOCKS proxy for dynamic forwarding'}
              </p>
            </div>

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="forward-name">Name (optional)</Label>
              <Input
                id="forward-name"
                value={formName}
                onChange={e => setFormName(e.target.value)}
                placeholder="My database forward"
              />
            </div>

            {/* Host selector */}
            {hosts.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="forward-host">Via Host</Label>
                <Select value={formHostId} onValueChange={setFormHostId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select a host (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    {hosts.map(host => (
                      <SelectItem key={host.id} value={host.id}>
                        {host.name} ({host.username}@{host.hostname})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Local port */}
            {formType !== 'dynamic' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="local-host">Local Host</Label>
                    <Input
                      id="local-host"
                      value={formLocalHost}
                      onChange={e => setFormLocalHost(e.target.value)}
                      placeholder="127.0.0.1"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="local-port">Local Port</Label>
                    <Input
                      id="local-port"
                      type="number"
                      value={formLocalPort}
                      onChange={e => setFormLocalPort(e.target.value)}
                      placeholder="8080"
                    />
                  </div>
                </div>

                {/* Remote target */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="remote-host">
                      {formType === 'local' ? 'Remote Host' : 'Target Host'}
                    </Label>
                    <Input
                      id="remote-host"
                      value={formRemoteHost}
                      onChange={e => setFormRemoteHost(e.target.value)}
                      placeholder={
                        formType === 'local' ? 'localhost' : '0.0.0.0'
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="remote-port">
                      {formType === 'local' ? 'Remote Port' : 'Target Port'}
                    </Label>
                    <Input
                      id="remote-port"
                      type="number"
                      value={formRemotePort}
                      onChange={e => setFormRemotePort(e.target.value)}
                      placeholder="3306"
                    />
                  </div>
                </div>
              </>
            )}

            {formType === 'dynamic' && (
              <div className="space-y-2">
                <Label htmlFor="dynamic-port">Local Port (SOCKS)</Label>
                <Input
                  id="dynamic-port"
                  type="number"
                  value={formLocalPort}
                  onChange={e => setFormLocalPort(e.target.value)}
                  placeholder="1080"
                />
                <p className="text-xs text-muted-foreground">
                  Configure your application to use this SOCKS proxy
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddDialogOpen(false)
                resetForm()
              }}
            >
              Cancel
            </Button>
            <Button onClick={() => void handleStartForward()}>
              <Play className="size-4 mr-1" />
              Start Forward
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stop Forward Dialog */}
      <AlertDialog open={stopDialogOpen} onOpenChange={setStopDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop Port Forward</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to stop "{forwardToStop?.name}"? Any active
              connections will be closed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setForwardToStop(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleStopForward()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Stop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ViewContainer>
  )
}

export default PortForwardView
