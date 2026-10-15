import { useEffect } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { toast } from 'sonner'
import locales from './locales'
import { router } from './router'
import { useAppStore } from './store/app'
import { useTeamStore } from './store/team'
import { getAppSettings } from './service/database'
import { applyNotificationPrefs } from './service/notifications'
import { syncCloseToTray } from './service/window-ux'
import { useTerminalHostWake } from './hooks/use-terminal-host-wake'
import {
  startWorkspaceRecovery,
  type WorkspaceRecoveryHandle,
} from './service/workspace-recovery'

// Leave enough time for SQLite/workspace recovery while reserving most of the
// ten-second first-terminal budget for PTY startup and the shell prompt.
export const STARTUP_TERMINAL_FALLBACK_MS = 2_000

// Recovery is retried for transient database/startup races, but remains
// bounded so a broken store cannot keep startup work alive indefinitely.
export const WORKSPACE_RECOVERY_RETRY_DELAYS_MS = [1_000, 2_000, 4_000] as const

export default function App() {
  const { i18n, t } = useTranslation()
  const theme = useAppStore(s => s.theme)
  const language = useAppStore(s => s.language)
  const hydrateFromDatabase = useAppStore(s => s.hydrateFromDatabase)
  const initializeTeam = useTeamStore(s => s.initialize)

  useTerminalHostWake()

  useEffect(() => {
    void initializeTeam()
  }, [initializeTeam])

  useEffect(() => {
    let disposed = false
    let recovery: WorkspaceRecoveryHandle | null = null
    let retryTimer: number | null = null
    let retryIndex = 0
    let activeRecoveryController: AbortController | null = null
    const fallbackTimer = window.setTimeout(() => {
      if (disposed) return
      const { tabs, addTab } = useAppStore.getState()
      if (tabs.length === 0) {
        addTab({ label: 'Local', type: 'local', startupFallback: true })
      }
    }, STARTUP_TERMINAL_FALLBACK_MS)

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer)
        retryTimer = null
      }
    }

    const attemptRecovery = () => {
      if (disposed) return
      const controller = new AbortController()
      activeRecoveryController = controller
      void startWorkspaceRecovery({ signal: controller.signal })
        .then(handle => {
          if (disposed) {
            controller.abort()
            handle.dispose()
            return
          }
          if (activeRecoveryController === controller) {
            activeRecoveryController = null
          }
          recovery = handle
          clearRetryTimer()
          // A restored tab is ready to be opened by MainLayout. Keep the
          // deadline fallback alive for an empty but valid workspace so the
          // first launch still reaches a usable local terminal.
          if (useAppStore.getState().tabs.length > 0) {
            window.clearTimeout(fallbackTimer)
          }
        })
        .catch(() => {
          if (activeRecoveryController === controller) {
            activeRecoveryController = null
          }
          controller.abort()
          if (disposed) return
          const delay = WORKSPACE_RECOVERY_RETRY_DELAYS_MS[retryIndex]
          if (delay === undefined) return
          retryIndex += 1
          retryTimer = window.setTimeout(() => {
            retryTimer = null
            attemptRecovery()
          }, delay)
        })
    }

    attemptRecovery()

    return () => {
      disposed = true
      window.clearTimeout(fallbackTimer)
      clearRetryTimer()
      activeRecoveryController?.abort()
      activeRecoveryController = null
      recovery?.dispose()
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const hydrated = await hydrateFromDatabase()
      if (!hydrated) {
        // Without this the app silently falls back to default theme, language
        // and preferences, which reads as the user's own settings changing.
        toast.error(t('startup.settingsRestoreFailed'))
      }
      try {
        const s = await getAppSettings()
        applyNotificationPrefs({
          nativeNotifications: s.nativeNotifications ?? true,
          notifyOnlyWhenUnfocused: s.notifyOnlyWhenUnfocused ?? true,
        })
        await syncCloseToTray(!!s.minimizeToTray)
      } catch (e) {
        console.warn('Failed to apply desktop UX prefs on startup:', e)
      }
    })()
  }, [hydrateFromDatabase, t])

  useEffect(() => {
    if (language && i18n.language !== language) {
      void i18n.changeLanguage(language)
    }
  }, [language, i18n])

  useEffect(() => {
    const applyTheme = (mode: string) => {
      const root = document.documentElement
      const dark =
        mode === 'dark' ||
        (mode === 'system' &&
          window.matchMedia('(prefers-color-scheme: dark)').matches)
      root.classList.toggle('dark', dark)
    }

    applyTheme(theme)

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onSystemChange = () => {
      if (theme === 'system') applyTheme('system')
    }
    mq.addEventListener('change', onSystemChange)
    return () => mq.removeEventListener('change', onSystemChange)
  }, [theme])

  return (
    <TooltipProvider>
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground">
        <I18nextProvider i18n={locales}>
          <RouterProvider router={router} />
          <Toaster />
        </I18nextProvider>
      </div>
    </TooltipProvider>
  )
}
