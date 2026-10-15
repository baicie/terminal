import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import '@/locales'

interface StartupErrorProps {
  error: string
  onRetry: () => void
}

export function StartupError({ error, onRetry }: StartupErrorProps) {
  // The bootstrap renders this screen before the main application chunk
  // mounts, so it cannot rely on App having installed the provider. Importing
  // i18n here initializes it on demand for every supported language.
  const { t } = useTranslation()

  return (
    <main className="flex min-h-screen w-full items-center justify-center bg-background px-4 py-8">
      <section
        className="flex w-full max-w-md flex-col items-start gap-5"
        role="alert"
        aria-live="assertive"
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
            <AlertTriangle aria-hidden="true" />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="text-lg font-semibold text-foreground">
              {t('startup.failure.title')}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t('startup.failure.description')}
            </p>
          </div>
        </div>

        <Alert variant="destructive" role="status">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{t('startup.failure.details')}</AlertTitle>
          <AlertDescription className="break-words">{error}</AlertDescription>
        </Alert>

        <p className="text-sm text-muted-foreground">
          {t('startup.failure.hint')}
        </p>

        <Button className="w-full sm:w-auto" onClick={onRetry} autoFocus>
          <RefreshCcw data-icon="inline-start" />
          {t('startup.failure.retry')}
        </Button>
      </section>
    </main>
  )
}
