import { useEffect } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import locales from './locales'
import { router } from './router'
import { useAppStore } from './store/app'
import { useTeamStore } from './store/team'
import { getAppSettings } from './service/database'
import { applyNotificationPrefs } from './service/notifications'
import { syncCloseToTray } from './service/window-ux'

export default function App() {
  const { i18n } = useTranslation()
  const theme = useAppStore(s => s.theme)
  const language = useAppStore(s => s.language)
  const hydrateFromDatabase = useAppStore(s => s.hydrateFromDatabase)
  const initializeTeam = useTeamStore(s => s.initialize)

  useEffect(() => {
    void initializeTeam()
  }, [initializeTeam])

  useEffect(() => {
    void (async () => {
      await hydrateFromDatabase()
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
  }, [hydrateFromDatabase])

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
