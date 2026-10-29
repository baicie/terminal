import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
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

function splitActiveTab(direction: 'horizontal' | 'vertical') {
  const { activeTabId, splitTab } = useAppStore.getState()
  if (activeTabId) splitTab(activeTabId, direction)
}

function closeActiveTab() {
  const { activeTabId, removeTab } = useAppStore.getState()
  if (activeTabId) removeTab(activeTabId)
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
  const isTerminalRoute = useLocation().pathname === '/terminal'

  useEffect(() => {
    const onTerminalRoute = (action: () => void) => () => {
      if (isTerminalRoute) action()
    }
    const onNextTab = onTerminalRoute(() => switchTab(1))
    const onPreviousTab = onTerminalRoute(() => switchTab(-1))
    const onSplitHorizontal = onTerminalRoute(() =>
      splitActiveTab('horizontal'),
    )
    const onSplitVertical = onTerminalRoute(() => splitActiveTab('vertical'))
    const onCloseTab = onTerminalRoute(closeActiveTab)

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
    window.addEventListener(
      `${SHORTCUT_EVENT_PREFIX}split-horizontal`,
      onSplitHorizontal,
    )
    window.addEventListener(
      `${SHORTCUT_EVENT_PREFIX}split-vertical`,
      onSplitVertical,
    )
    window.addEventListener(`${SHORTCUT_EVENT_PREFIX}close-tab`, onCloseTab)

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
      window.removeEventListener(
        `${SHORTCUT_EVENT_PREFIX}split-horizontal`,
        onSplitHorizontal,
      )
      window.removeEventListener(
        `${SHORTCUT_EVENT_PREFIX}split-vertical`,
        onSplitVertical,
      )
      window.removeEventListener(
        `${SHORTCUT_EVENT_PREFIX}close-tab`,
        onCloseTab,
      )
    }
  }, [isTerminalRoute, onNewLocalTerminal, onToggleSidebar])

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
