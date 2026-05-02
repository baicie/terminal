import { useTranslation } from 'react-i18next'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'

type ToggleKey =
  | 'copyOnSelect'
  | 'pasteOnMiddleClick'
  | 'allowProposedApi'
  | 'minimizeToTray'
  | 'nativeNotifications'
  | 'notifyOnlyWhenUnfocused'

interface GeneralSettingsProps {
  settings: {
    copyOnSelect: boolean
    pasteOnMiddleClick: boolean
    allowProposedApi: boolean
    minimizeToTray?: boolean
    nativeNotifications?: boolean
    notifyOnlyWhenUnfocused?: boolean
  }
  updateSetting: <K extends ToggleKey>(key: K, value: boolean) => void
}

interface ToggleRowProps {
  id: string
  title: string
  description: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
}

function ToggleRow({
  id,
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
}: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 min-w-0">
        <Label htmlFor={id} className="text-sm font-medium">
          {title}
        </Label>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  )
}

export function GeneralSettings({
  settings,
  updateSetting,
}: GeneralSettingsProps) {
  const { t } = useTranslation()
  const nativeOn = settings.nativeNotifications ?? true

  return (
    <div className="space-y-5 py-4">
      {/* === Terminal interaction === */}
      <div className="space-y-4">
        <ToggleRow
          id="copyOnSelect"
          title={t('settings.copyOnSelect')}
          description={t('settings.copyOnSelectDesc')}
          checked={settings.copyOnSelect}
          onCheckedChange={v => updateSetting('copyOnSelect', v)}
        />
        <ToggleRow
          id="pasteOnMiddleClick"
          title={t('settings.pasteOnMiddleClick')}
          description={t('settings.pasteOnMiddleClickDesc')}
          checked={settings.pasteOnMiddleClick}
          onCheckedChange={v => updateSetting('pasteOnMiddleClick', v)}
        />
        <ToggleRow
          id="allowProposedApi"
          title={t('settings.allowProposedApi')}
          description={t('settings.allowProposedApiDesc')}
          checked={settings.allowProposedApi}
          onCheckedChange={v => updateSetting('allowProposedApi', v)}
        />
      </div>

      <Separator />

      {/* === Desktop UX === */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-foreground">
          {t('settings.desktopSection')}
        </h3>
        <ToggleRow
          id="minimizeToTray"
          title={t('settings.minimizeToTray')}
          description={t('settings.minimizeToTrayDesc')}
          checked={settings.minimizeToTray ?? false}
          onCheckedChange={v => updateSetting('minimizeToTray', v)}
        />
        <ToggleRow
          id="nativeNotifications"
          title={t('settings.nativeNotifications')}
          description={t('settings.nativeNotificationsDesc')}
          checked={nativeOn}
          onCheckedChange={v => updateSetting('nativeNotifications', v)}
        />
        <ToggleRow
          id="notifyOnlyWhenUnfocused"
          title={t('settings.notifyOnlyWhenUnfocused')}
          description={t('settings.notifyOnlyWhenUnfocusedDesc')}
          checked={settings.notifyOnlyWhenUnfocused ?? true}
          onCheckedChange={v => updateSetting('notifyOnlyWhenUnfocused', v)}
          disabled={!nativeOn}
        />
      </div>
    </div>
  )
}
