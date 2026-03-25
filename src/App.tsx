import { isRegistered, register } from '@tauri-apps/plugin-global-shortcut'
import dayjs from 'dayjs'
import { useEffect } from 'react'
import { I18nextProvider, useTranslation } from 'react-i18next'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import locales from './locales'
import { router } from './router'
import { useAppStore } from './store/app'
import { useTeamStore } from './store/team'
import 'dayjs/locale/en'
import 'dayjs/locale/fr'
import 'dayjs/locale/zh-cn'

export default function App() {
  const { i18n } = useTranslation()
  const theme = useAppStore(s => s.theme)
  const language = useAppStore(s => s.language)
  const hydrateFromDatabase = useAppStore(s => s.hydrateFromDatabase)
  const initializeTeam = useTeamStore(s => s.initialize)

  useEffect(() => {
    // Initialize team store on app start
    void initializeTeam()
  }, [initializeTeam])

  useEffect(() => {
    const registerShortcuts = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')

        if (!(await isRegistered('CommandOrControl+W'))) {
          await register('CommandOrControl+W', async event => {
            if (event.state === 'Pressed') {
              await getCurrentWindow().hide()
            }
          })
        }
        if (!(await isRegistered('CommandOrControl+M'))) {
          await register('CommandOrControl+M', async event => {
            if (event.state === 'Pressed') {
              await getCurrentWindow().minimize()
            }
          })
        }
        if (!(await isRegistered('CommandOrControl+H'))) {
          await register('CommandOrControl+H', async event => {
            if (event.state === 'Pressed') {
              await getCurrentWindow().hide()
            }
          })
        }
        if (!(await isRegistered('CommandOrControl+,'))) {
          await register('CommandOrControl+,', async () => {
            window.dispatchEvent(new CustomEvent('open-settings'))
          })
        }
      } catch (e) {
        console.warn('Failed to register global shortcuts:', e)
      }
    }

    registerShortcuts()

    return () => {
      import('@tauri-apps/plugin-global-shortcut').then(({ unregisterAll }) => {
        unregisterAll().catch(() => {})
      })
    }
  }, [])

  useEffect(() => {
    void hydrateFromDatabase()
  }, [hydrateFromDatabase])

  useEffect(() => {
    const handleLanguageChange = (lng: string) => {
      dayjs.locale(lng === 'cn' ? 'zh-cn' : lng)
    }

    handleLanguageChange(i18n.language)
    i18n.on('languageChanged', handleLanguageChange)

    return () => {
      i18n.off('languageChanged', handleLanguageChange)
    }
  }, [i18n])

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

  useEffect(() => {
    if (language && i18n.language !== language) {
      void i18n.changeLanguage(language)
    }
  }, [language, i18n])

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
