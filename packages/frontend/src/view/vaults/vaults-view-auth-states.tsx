import {
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Plus,
  Shield,
  Unlock,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface SharedAuthProps {
  password: string
  showPassword: boolean
  error: string | null
  onPasswordChange: (value: string) => void
  onShowPasswordChange: (value: boolean) => void
}

interface CreateVaultStateProps extends SharedAuthProps {
  confirmPassword: string
  creating: boolean
  /** File-state notice, e.g. an interrupted create reported by the backend. */
  notice?: string | null
  onConfirmPasswordChange: (value: string) => void
  onCreate: () => void
}

function PasswordVisibilityButton({
  visible,
  onChange,
}: {
  visible: boolean
  onChange: (value: boolean) => void
}) {
  const { t } = useTranslation()
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="absolute right-0 top-0 h-full px-3"
      aria-label={t('vaults.togglePasswordVisibility')}
      onClick={() => onChange(!visible)}
    >
      {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
    </Button>
  )
}

function VaultError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div role="alert" className="flex items-center gap-2 text-destructive text-sm">
      <AlertCircle className="size-4" />
      {error}
    </div>
  )
}

function VaultNotice({ notice }: { notice?: string | null }) {
  if (!notice) return null
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <span>{notice}</span>
    </div>
  )
}

export function CreateVaultState(props: CreateVaultStateProps) {
  const { t } = useTranslation()
  return (
    <div
      className="flex items-center justify-center h-full p-4 sm:p-8"
      onKeyDown={event => {
        if (event.key === 'Enter') props.onCreate()
      }}
    >
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <Shield className="size-12 sm:size-16 mx-auto text-primary" />
          <h2 className="text-xl sm:text-2xl font-semibold">
            {t('vaults.createVault')}
          </h2>
          <p className="text-muted-foreground">{t('vaults.secureVault')}</p>
        </div>
        <div className="space-y-4">
          <VaultNotice notice={props.notice} />
          <div className="space-y-2">
            <Label htmlFor="create-password">{t('vaults.masterPassword')}</Label>
            <div className="relative">
              <Input
                id="create-password"
                type={props.showPassword ? 'text' : 'password'}
                value={props.password}
                onChange={event => props.onPasswordChange(event.target.value)}
                placeholder={t('vaults.enterStrongPassword')}
              />
              <PasswordVisibilityButton
                visible={props.showPassword}
                onChange={props.onShowPasswordChange}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">{t('vaults.confirmPassword')}</Label>
            <Input
              id="confirm-password"
              type={props.showPassword ? 'text' : 'password'}
              value={props.confirmPassword}
              onChange={event =>
                props.onConfirmPasswordChange(event.target.value)
              }
              placeholder={t('vaults.confirmYourPassword')}
            />
          </div>
          <VaultError error={props.error} />
          <Button
            className="w-full"
            onClick={props.onCreate}
            disabled={props.creating}
          >
            {props.creating ? (
              <>
                <Loader2 className="size-4 mr-2 animate-spin" />
                {t('vaults.creating')}
              </>
            ) : (
              <>
                <Plus className="size-4 mr-2" />
                {t('vaults.createVault')}
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            {t('vaults.warning')}
          </p>
        </div>
      </div>
    </div>
  )
}

interface LockedVaultStateProps extends SharedAuthProps {
  onUnlock: () => void
}

export function LockedVaultState(props: LockedVaultStateProps) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-center h-full p-4 sm:p-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <Lock className="size-12 sm:size-16 mx-auto text-primary" />
          <h2 className="text-xl sm:text-2xl font-semibold">
            {t('vaults.vaultLocked')}
          </h2>
          <p className="text-muted-foreground">{t('vaults.unlockDesc')}</p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="unlock-password">{t('vaults.masterPassword')}</Label>
            <div className="relative">
              <Input
                id="unlock-password"
                type={props.showPassword ? 'text' : 'password'}
                value={props.password}
                onChange={event => props.onPasswordChange(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') props.onUnlock()
                }}
                placeholder={t('vaults.enterMasterPassword')}
              />
              <PasswordVisibilityButton
                visible={props.showPassword}
                onChange={props.onShowPasswordChange}
              />
            </div>
          </div>
          <VaultError error={props.error} />
          <Button className="w-full" onClick={props.onUnlock}>
            <Unlock className="size-4 mr-2" />
            {t('vaults.unlock')}
          </Button>
        </div>
      </div>
    </div>
  )
}
