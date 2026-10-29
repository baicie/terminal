import type { WorkspaceLayout } from '@/types'
import { useAppStore } from '@/store/app'
import { useWorkspaceStore } from '@/store/workspace'

type RestorableLayout = Pick<
  WorkspaceLayout,
  'tabs' | 'splitGroups' | 'activeTabId' | 'sidebarVisible'
>

const EMPTY_LAYOUT: RestorableLayout = {
  tabs: [],
  splitGroups: [],
  activeTabId: null,
  sidebarVisible: true,
}

let switchQueue: Promise<void> = Promise.resolve()
const MAX_STABILITY_ATTEMPTS = 5

function readCurrentLayout(): RestorableLayout {
  const { tabs, splitGroups, activeTabId, sidebarVisible } =
    useAppStore.getState()
  return { tabs, splitGroups, activeTabId, sidebarVisible }
}

function isCurrentLayout(layout: RestorableLayout): boolean {
  const current = useAppStore.getState()
  return (
    current.tabs === layout.tabs &&
    current.splitGroups === layout.splitGroups &&
    current.activeTabId === layout.activeTabId &&
    current.sidebarVisible === layout.sidebarVisible
  )
}

function restoreWorkspaceMemory(activeWorkspaceId: string | null) {
  useWorkspaceStore.setState(state => ({
    activeWorkspaceId,
    workspaces: state.workspaces.map(workspace => ({
      ...workspace,
      isActive: workspace.id === activeWorkspaceId,
    })),
  }))
}

async function saveStableCurrentLayout(
  workspaceId: string,
): Promise<RestorableLayout> {
  for (let attempt = 0; attempt < MAX_STABILITY_ATTEMPTS; attempt++) {
    const layout = readCurrentLayout()
    const workspaceState = useWorkspaceStore.getState()
    await workspaceState.saveLayout(
      workspaceId,
      layout.tabs,
      layout.splitGroups,
      layout.activeTabId,
      layout.sidebarVisible,
    )
    if (isCurrentLayout(layout)) return layout
  }
  throw new Error('Terminal layout kept changing during workspace switch')
}

async function performWorkspaceSwitch(targetWorkspaceId: string) {
  const workspaceState = useWorkspaceStore.getState()
  const previousWorkspaceId = workspaceState.activeWorkspaceId
  if (targetWorkspaceId === previousWorkspaceId) return
  if (!workspaceState.workspaces.some(item => item.id === targetWorkspaceId)) {
    throw new Error(`Workspace not found: ${targetWorkspaceId}`)
  }

  let stableLayout = readCurrentLayout()
  if (previousWorkspaceId) {
    await workspaceState.saveLayout(
      previousWorkspaceId,
      stableLayout.tabs,
      stableLayout.splitGroups,
      stableLayout.activeTabId,
      stableLayout.sidebarVisible,
    )
  }
  const targetLayout = await workspaceState.loadLayout(targetWorkspaceId)

  for (let attempt = 0; attempt < MAX_STABILITY_ATTEMPTS; attempt++) {
    if (previousWorkspaceId && !isCurrentLayout(stableLayout)) {
      stableLayout = await saveStableCurrentLayout(previousWorkspaceId)
    }

    try {
      await useWorkspaceStore.getState().setActiveWorkspace(targetWorkspaceId)
    } catch (error) {
      restoreWorkspaceMemory(previousWorkspaceId)
      throw error
    }

    if (!previousWorkspaceId || isCurrentLayout(stableLayout)) {
      try {
        useAppStore.getState().restoreLayout(targetLayout ?? EMPTY_LAYOUT)
        return
      } catch (error) {
        restoreWorkspaceMemory(previousWorkspaceId)
        if (previousWorkspaceId) {
          try {
            await useWorkspaceStore
              .getState()
              .setActiveWorkspace(previousWorkspaceId)
          } catch {
            // The atomic database update either fully succeeds or leaves target active.
          }
        }
        useAppStore.setState(stableLayout)
        throw error
      }
    }

    restoreWorkspaceMemory(previousWorkspaceId)
    await useWorkspaceStore.getState().setActiveWorkspace(previousWorkspaceId!)
  }

  throw new Error('Terminal layout kept changing during workspace switch')
}

async function performWorkspaceDelete(workspaceId: string) {
  const workspaceState = useWorkspaceStore.getState()
  if (workspaceState.workspaces.length <= 1) return

  if (workspaceState.activeWorkspaceId === workspaceId) {
    const successor = workspaceState.workspaces.find(
      workspace => workspace.id !== workspaceId,
    )
    if (!successor) return
    await performWorkspaceSwitch(successor.id)
  }

  await useWorkspaceStore.getState().deleteWorkspace(workspaceId)
}

function enqueueWorkspaceOperation(operation: () => Promise<void>) {
  const queued = switchQueue.then(operation)
  switchQueue = queued.catch(() => undefined)
  return queued
}

export function switchWorkspaceLayout(
  targetWorkspaceId: string,
): Promise<void> {
  return enqueueWorkspaceOperation(() =>
    performWorkspaceSwitch(targetWorkspaceId),
  )
}

export function deleteWorkspaceAndSwitch(workspaceId: string): Promise<void> {
  return enqueueWorkspaceOperation(() => performWorkspaceDelete(workspaceId))
}
