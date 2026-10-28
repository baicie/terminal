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
  STARTUP_TERMINAL_FALLBACK_MS,
  WORKSPACE_RECOVERY_RETRY_DELAYS_MS,
  useStartupWorkspaceRecovery,
} from './app-startup-recovery'

// Leave enough time for SQLite/workspace recovery while reserving most of the
// ten-second first-terminal budget for PTY startup and the shell prompt.
export { STARTUP_TERMINAL_FALLBACK_MS, WORKSPACE_RECOVERY_RETRY_DELAYS_MS }

interface AppProps {
  /** Absolute attempt deadline supplied by the bootstrapper. */
  startupTerminalFallbackAt?: number
}

export default function App({ startupTerminalFallbackAt }: AppProps) {
  const { i18n, t } = useTranslation()
  const theme = useAppStore(s => s.theme)
  const language = useAppStore(s => s.language)
  const hydrateFromDatabase = useAppStore(s => s.hydrateFromDatabase)
  const initializeTeam = useTeamStore(s => s.initialize)

  useTerminalHostWake()

  useEffect(() => {
    void initializeTeam()
  }, [initializeTeam])

  useStartupWorkspaceRecovery(startupTerminalFallbackAt)

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
