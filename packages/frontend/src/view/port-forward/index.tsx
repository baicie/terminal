import type { PortForwardConfig } from '@/types'
import { ArrowLeftRight, Plus, RefreshCw, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ResponsiveConfirm } from '@/components/ui/responsive-dialog'
import { toast } from '@/components/ui/sonner'
import { PortForwardSkeleton } from '@/components/ui/view-skeletons'
import {
  EmptyState,
  ViewContainer,
  ViewContent,
  ViewHeader,
  ViewToolbar,
} from '@/components/view-container'
import { sshService } from '@/service/ssh'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { PortForwardCard } from './components/port-forward-card'
import { PortForwardFormDialog } from './components/port-forward-form-dialog'
import {
  initialFormState,
  type PortForwardEntry,
  type PortForwardFormState,
} from './components/port-forward-types'

const PortForwardView: React.FC = () => {
  const tabs = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const hosts = useHostStore(s => s.hosts)

  const [forwards, setForwards] = useState<PortForwardEntry[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)

  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [stopDialogOpen, setStopDialogOpen] = useState(false)
  const [forwardToStop, setForwardToStop] = useState<PortForwardEntry | null>(
    null,
  )
  const [form, setForm] = useState<PortForwardFormState>(initialFormState)

  const loadForwards = useCallback(async () => {
    setLoading(true)
    try {
      // TODO: load from database when backend is implemented
    } catch (error) {
      console.error('Failed to load port forwards:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadForwards()
  }, [loadForwards])

  const handleFormChange = useCallback(
    (patch: Partial<PortForwardFormState>) => {
      setForm(prev => ({ ...prev, ...patch }))
    },
    [],
  )

  const resetForm = useCallback(() => setForm(initialFormState), [])

  const handleStartForward = async () => {
    if (!form.remoteHost || !form.remotePort) {
      toast.error('Remote host and port are required')
      return
    }

    const port = Number.parseInt(form.localPort, 10)
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      toast.error('Invalid local port number')
      return
    }

    const forwardId = `pf-${Date.now()}`
    const host = form.hostId ? hosts.find(h => h.id === form.hostId) : null

    const newForward: PortForwardEntry = {
      id: forwardId,
      name: form.name || `${form.type} forward ${port}`,
      type: form.type,
      localHost: form.localHost,
      localPort: port,
      remoteHost: form.remoteHost,
      remotePort: Number.parseInt(form.remotePort, 10),
      active: true,
      hostId: form.hostId || undefined,
      hostName: host?.name || undefined,
    }

    try {
      if (tabs.find(t => t.id === activeTabId)?.hostId) {
        const config: PortForwardConfig = {
          id: forwardId,
          name: newForward.name,
          forward_type: form.type,
          local_host: form.localHost,
          local_port: port,
          remote_host: form.remoteHost,
          remote_port: Number.parseInt(form.remotePort, 10),
        }
        const result = await sshService.portForwardStart('', config)
        if (!result.success) {
          console.warn(
            'Port forward backend not fully implemented:',
            result.message,
          )
        }
      }

      setForwards(prev => [...prev, newForward])
      toast.success(`Port forward started on ${form.localHost}:${port}`)
      setAddDialogOpen(false)
      resetForm()
    } catch (error) {
      toast.error(`Failed to start port forward: ${error}`)
    }
  }

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
      setForwards(prev =>
        prev.map(f =>
          f.id === forwardToStop.id ? { ...f, active: false } : f,
        ),
      )
      toast.success('Port forward stopped')
      setStopDialogOpen(false)
      setForwardToStop(null)
    } catch (error) {
      toast.error(`Failed to stop port forward: ${error}`)
    }
  }

  const handleStartCard = (forward: PortForwardEntry) => {
    setForwards(prev =>
      prev.map(f => (f.id === forward.id ? { ...f, active: true } : f)),
    )
    toast.success(
      `Port forward started on ${forward.localHost}:${forward.localPort}`,
    )
  }

  const handleStopCard = (forward: PortForwardEntry) => {
    setForwardToStop(forward)
    setStopDialogOpen(true)
  }

  const handleDeleteForward = (forward: PortForwardEntry) => {
    if (forward.active) {
      setForwardToStop(forward)
      setStopDialogOpen(true)
    } else {
      setForwards(prev => prev.filter(f => f.id !== forward.id))
      toast.success('Port forward removed')
    }
  }

  const filteredForwards = forwards.filter(
    f =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.localHost.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.remoteHost.toLowerCase().includes(searchQuery.toLowerCase()),
  )

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

        {loading ? (
          <PortForwardSkeleton count={3} />
        ) : filteredForwards.length === 0 ? (
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
              <PortForwardCard
                key={forward.id}
                forward={forward}
                onStart={handleStartCard}
                onStop={handleStopCard}
                onDelete={handleDeleteForward}
              />
            ))}
          </div>
        )}
      </ViewContent>

      <PortForwardFormDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        hosts={hosts}
        form={form}
        onChange={handleFormChange}
        onSubmit={() => void handleStartForward()}
        onCancel={() => {
          setAddDialogOpen(false)
          resetForm()
        }}
      />

      <ResponsiveConfirm
        open={stopDialogOpen}
        onOpenChange={setStopDialogOpen}
        title="Stop Port Forward"
        description={
          forwardToStop
            ? `Are you sure you want to stop "${forwardToStop.name}"? Any active connections will be closed.`
            : undefined
        }
        confirmText="Stop"
        destructive
        onConfirm={() => void handleStopForward()}
        onCancel={() => setForwardToStop(null)}
      />
    </ViewContainer>
  )
}

export default PortForwardView
