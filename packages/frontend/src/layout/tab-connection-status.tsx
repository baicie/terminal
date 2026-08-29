import type { Tab } from '@/types'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export function TabConnectionStatus({
  status,
}: {
  status: Tab['connectionStatus']
}) {
  const { t } = useTranslation()
  if (!status) return null
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        status === 'connected'
          ? 'bg-success'
          : status === 'connecting'
            ? 'bg-warning animate-pulse'
            : 'bg-muted-foreground/60',
      )}
      data-status={status}
      data-testid={`tab-status-${status}`}
      title={t(`terminal.status.${status}`)}
    />
  )
}
