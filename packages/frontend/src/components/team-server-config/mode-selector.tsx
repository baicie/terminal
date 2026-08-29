import { Link, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export type TeamServerMode = 'local' | 'cloud'

interface ModeSelectorProps {
  mode: TeamServerMode
  onChange: (mode: TeamServerMode) => void
}

export function ModeSelector({ mode, onChange }: ModeSelectorProps) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-2">
      <Label>{t('settings.mode')}</Label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ModeButton
          active={mode === 'local'}
          icon={<Server />}
          title={t('settings.local')}
          description={t('settings.localModeDesc')}
          onClick={() => onChange('local')}
        />
        <ModeButton
          active={mode === 'cloud'}
          icon={<Link />}
          title={t('settings.cloud')}
          description={t('settings.cloudModeDesc')}
          onClick={() => onChange('cloud')}
        />
      </div>
    </div>
  )
}

function ModeButton({
  active,
  icon,
  title,
  description,
  onClick,
}: {
  active: boolean
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        'h-auto min-h-24 flex-col gap-2 whitespace-normal p-4 text-center',
        active && 'border-primary bg-primary/5',
      )}
      aria-pressed={active}
      onClick={onClick}
    >
      {icon}
      <span className="text-sm font-medium">{title}</span>
      <span className="text-xs text-muted-foreground">{description}</span>
    </Button>
  )
}
