import type { PortForwardConfig } from '@/types'
import { ArrowLeftRight, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ResponsiveConfirm } from '@/components/ui/responsive-dialog'
import { toast } from '@/components/ui/sonner'
import { PortForwardSkeleton } from '@/components/ui/view-skeletons'
import { EmptyState, ViewContainer, ViewContent, ViewHeader } from '@/components/view-container'
import {
  createPortForwardRule,
  deletePortForwardRule,
  getPortForwardRules,
} from '@/service/database'
import { sshService } from '@/service/ssh'
import { useAppStore } from '@/store/app'
import { useHostStore } from '@/store/host'
import { PortForwardCard } from './components/port-forward-card'
import { PortForwardFormDialog } from './components/port-forward-form-dialog'
import { PortForwardToolbar } from './components/port-forward-toolbar'
import {
  initialFormState,
  type PortForwardEntry,
  type PortForwardFormState,
} from './components/port-forward-types'

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const toConfig = (entry: PortForwardEntry): PortForwardConfig => ({
  id: entry.id,
  name: entry.name,
  forward_type: entry.type,
  local_host: entry.localHost,
  local_port: entry.localPort,
  remote_host: entry.remoteHost,
  remote_port: entry.remotePort,
})

const PortForwardView: React.FC = () => {
  const { t } = useTranslation()
  const tabs = useAppStore(s => s.tabs)
  const activeTabId = useAppStore(s => s.activeTabId)
  const hosts = useHostStore(s => s.hosts)

  const [forwards, setForwards] = useState<PortForwardEntry[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [target, setTarget] = useState<PortForwardEntry | null>(null)
  const [pendingAction, setPendingAction] = useState<'stop' | 'delete' | null>(null)
  const [form, setForm] = useState<PortForwardFormState>(initialFormState)

  const loadForwards = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await getPortForwardRules()
      setForwards(
        rows.map(r => ({
          id: r.id,
          name: r.name,
          type: r.type as PortForwardEntry['type'],
          localHost: r.local_host,
          localPort: r.local_port,
          remoteHost: r.remote_host,
          remotePort: r.remote_port,
          active: false,
          hostId: r.host_id ?? undefined,
        })),
      )
    } catch (error) {
      toast.error(t('portForwardView.loadFailed', { message: messageOf(error) }))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadForwards()
  }, [loadForwards])

  const handleFormChange = (patch: Partial<PortForwardFormState>) =>
    setForm(prev => ({ ...prev, ...patch }))

  const resetForm = () => setForm(initialFormState)

  // 只有当前标签真的挂了 SSH 主机，才存在可承载转发的会话。
  const hasSession = Boolean(tabs.find(tab => tab.id === activeTabId)?.hostId)

  const closeConfirm = () => {
    setPendingAction(null)
    setTarget(null)
  }

  /** 打开隧道。返回 false 表示后端明确失败，调用方不得把规则标记为运行中。 */
  const openTunnel = async (entry: PortForwardEntry) => {
    const result = await sshService.portForwardStart('', toConfig(entry))
    if (result.success) return true
    toast.error(t('portForwardView.startFailed', { message: result.message ?? '' }))
    return false
  }

  const handleStartForward = async () => {
    if (!form.remoteHost || !form.remotePort) {
      toast.error(t('portForwardView.remoteRequired'))
      return
    }
    const port = Number.parseInt(form.localPort, 10)
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      toast.error(t('portForwardView.invalidLocalPort'))
      return
    }

    const remotePort = Number.parseInt(form.remotePort, 10)
    const entry: PortForwardEntry = {
      id: `pf-${Date.now()}`,
      name: form.name || `${form.type} forward ${port}`,
      type: form.type,
      localHost: form.localHost,
      localPort: port,
      remoteHost: form.remoteHost,
      remotePort,
      active: false,
      hostId: form.hostId || undefined,
      hostName: hosts.find(h => h.id === form.hostId)?.name || undefined,
    }

    // 没有 SSH 会话就只保存规则：绝不把「未启动」显示成「已运行」。
    if (hasSession) {
      if (!(await openTunnel(entry))) return
      entry.active = true
    }

    try {
      await createPortForwardRule({
        id: entry.id,
        name: entry.name,
        type: form.type,
        local_host: form.localHost,
        local_port: port,
        remote_host: form.remoteHost,
        remote_port: remotePort,
        host_id: form.hostId || null,
        enabled: entry.active ? 1 : 0,
      })
      setForwards(prev => [...prev, entry])
      const address = `${entry.localHost}:${port}`
      if (entry.active) toast.success(t('portForwardView.started', { address }))
      else toast.warning(t('portForwardView.savedNotStarted'))
      setAddDialogOpen(false)
      resetForm()
    } catch (error) {
      toast.error(t('portForwardView.startFailed', { message: messageOf(error) }))
    }
  }

  const handleStartCard = async (forward: PortForwardEntry) => {
    if (!(await openTunnel(forward))) return
    setForwards(prev => prev.map(f => (f.id === forward.id ? { ...f, active: true } : f)))
    const address = `${forward.localHost}:${forward.localPort}`
    toast.success(t('portForwardView.started', { address }))
  }

  const handleStopForward = async () => {
    if (!target) return
    const result = await sshService.portForwardStop(target.id)
    if (!result.success) {
      toast.error(t('portForwardView.stopFailed', { message: result.message ?? '' }))
      return
    }
    setForwards(prev => prev.map(f => (f.id === target.id ? { ...f, active: false } : f)))
    toast.success(t('portForwardView.stopSuccess'))
    closeConfirm()
  }

  const handleDeleteForward = async () => {
    if (!target) return
    try {
      await deletePortForwardRule(target.id)
      setForwards(prev => prev.filter(f => f.id !== target.id))
      toast.success(t('portForwardView.removed'))
    } catch (error) {
      toast.error(t('portForwardView.loadFailed', { message: messageOf(error) }))
    } finally {
      closeConfirm()
    }
  }

  /** 运行中的规则不能直接删除：先走「停止」确认，避免规则消失而隧道仍在。 */
  const requestDelete = (forward: PortForwardEntry) => {
    setTarget(forward)
    setPendingAction(forward.active ? 'stop' : 'delete')
  }

  const filteredForwards = forwards.filter(
    f =>
      f.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.localHost.toLowerCase().includes(searchQuery.toLowerCase()) ||
      f.remoteHost.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  const isDelete = pendingAction === 'delete'

  return (
    <ViewContainer>
      <PortForwardToolbar
        searchQuery={searchQuery}
        loading={loading}
        onSearchChange={setSearchQuery}
        onRefresh={() => void loadForwards()}
        onAdd={() => setAddDialogOpen(true)}
      />

      <ViewContent className="p-4 sm:p-6">
        <ViewHeader
          title={t('portForwardView.title')}
          description={t('portForwardView.forwardsDesc')}
        />

        {loading ? (
          <PortForwardSkeleton count={3} />
        ) : filteredForwards.length === 0 ? (
          <EmptyState
            icon={<ArrowLeftRight className="size-12" />}
            title={t('portForwardView.noForwards')}
            description={t('portForwardView.forwardsDesc')}
            action={
              <Button onClick={() => setAddDialogOpen(true)}>
                <Plus className="size-4 mr-1" data-icon="inline-start" />
                {t('portForwardView.addForward')}
              </Button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredForwards.map(forward => (
              <PortForwardCard
                key={forward.id}
                forward={forward}
                onStart={forward => void handleStartCard(forward)}
                onStop={forward => {
                  setTarget(forward)
                  setPendingAction('stop')
                }}
                onDelete={requestDelete}
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
        open={pendingAction !== null}
        onOpenChange={open => {
          if (!open) closeConfirm()
        }}
        title={t(isDelete ? 'portForwardView.deleteTitle' : 'portForwardView.stopTitle')}
        description={
          target
            ? t(isDelete ? 'portForwardView.deleteConfirm' : 'portForwardView.stopConfirm', {
                name: target.name,
              })
            : undefined
        }
        confirmText={t(isDelete ? 'common.delete' : 'portForward.stop')}
        cancelText={t('common.cancel')}
        destructive
        onConfirm={() => void (isDelete ? handleDeleteForward() : handleStopForward())}
        onCancel={() => setTarget(null)}
      />
    </ViewContainer>
  )
}

export default PortForwardView
