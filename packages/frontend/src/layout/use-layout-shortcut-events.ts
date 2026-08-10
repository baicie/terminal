import { useEffect } from 'react'
import { SHORTCUT_EVENT_PREFIX } from '@/hooks/use-global-shortcuts'
import { useAppStore } from '@/store/app'

interface LayoutShortcutHandlers {
  onNewLocalTerminal: () => void
  onToggleSidebar: () => void
  onToggleHelp: () => void
  onOpenHelp: () => void
}

function switchTab(offset: number) {
  const { tabs, activeTabId, setActiveTab } = useAppStore.getState()
  if (tabs.length <= 1) return

  const currentIndex = tabs.findIndex(tab => tab.id === activeTabId)
  const nextIndex = (currentIndex + offset + tabs.length) % tabs.length
  const tabId = tabs[nextIndex].id
  setActiveTab(tabId)
  window.dispatchEvent(
    new CustomEvent('terminal:switch-tab', { detail: { tabId } }),
  )
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

export function useLayoutShortcutEvents({
  onNewLocalTerminal,
  onToggleSidebar,
  onToggleHelp,
  onOpenHelp,
}: LayoutShortcutHandlers) {
  useEffect(() => {
    const onNextTab = () => switchTab(1)
    const onPreviousTab = () => switchTab(-1)

    window.addEventListener(
      `${SHORTCUT_EVENT_PREFIX}new-tab`,
      onNewLocalTerminal,
    )
    window.addEventListener(
      `${SHORTCUT_EVENT_PREFIX}new-local`,
      onNewLocalTerminal,
    )
    window.addEventListener(
      `${SHORTCUT_EVENT_PREFIX}toggle-sidebar`,
      onToggleSidebar,
    )
    window.addEventListener(`${SHORTCUT_EVENT_PREFIX}next-tab`, onNextTab)
    window.addEventListener(`${SHORTCUT_EVENT_PREFIX}prev-tab`, onPreviousTab)

    return () => {
      window.removeEventListener(
        `${SHORTCUT_EVENT_PREFIX}new-tab`,
        onNewLocalTerminal,
      )
      window.removeEventListener(
        `${SHORTCUT_EVENT_PREFIX}new-local`,
        onNewLocalTerminal,
      )
      window.removeEventListener(
        `${SHORTCUT_EVENT_PREFIX}toggle-sidebar`,
        onToggleSidebar,
      )
      window.removeEventListener(`${SHORTCUT_EVENT_PREFIX}next-tab`, onNextTab)
      window.removeEventListener(
        `${SHORTCUT_EVENT_PREFIX}prev-tab`,
        onPreviousTab,
      )
    }
  }, [onNewLocalTerminal, onToggleSidebar])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const shouldToggle =
        ((event.ctrlKey || event.metaKey) && event.key === '/') ||
        (event.shiftKey && event.key === '?' && !isEditableTarget(event.target))

      if (shouldToggle) {
        event.preventDefault()
        onToggleHelp()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('open-shortcuts-help', onOpenHelp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('open-shortcuts-help', onOpenHelp)
    }
  }, [onOpenHelp, onToggleHelp])
}
