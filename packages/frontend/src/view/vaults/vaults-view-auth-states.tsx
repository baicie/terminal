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
  return (
    <Button
      variant="ghost"
      size="icon"
      className="absolute right-0 top-0 h-full px-3"
      onClick={() => onChange(!visible)}
    >
      {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
    </Button>
  )
}

function VaultError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <div className="flex items-center gap-2 text-destructive text-sm">
      <AlertCircle className="h-4 w-4" />
      {error}
    </div>
  )
}

export function CreateVaultState(props: CreateVaultStateProps) {
  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <Shield className="h-16 w-16 mx-auto text-primary" />
          <h2 className="text-2xl font-semibold">Create Your Vault</h2>
          <p className="text-muted-foreground">
            Securely store sensitive data like passwords, SSH keys, and API
            tokens using AES-256 encryption.
          </p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="create-password">Master Password</Label>
            <div className="relative">
              <Input
                id="create-password"
                type={props.showPassword ? 'text' : 'password'}
                value={props.password}
                onChange={event => props.onPasswordChange(event.target.value)}
                placeholder="Enter a strong password"
              />
              <PasswordVisibilityButton
                visible={props.showPassword}
                onChange={props.onShowPasswordChange}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirm Password</Label>
            <Input
              id="confirm-password"
              type={props.showPassword ? 'text' : 'password'}
              value={props.confirmPassword}
              onChange={event =>
                props.onConfirmPasswordChange(event.target.value)
              }
              placeholder="Confirm your password"
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
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Creating...
              </>
            ) : (
              <>
                <Plus className="h-4 w-4 mr-2" />
                Create Vault
              </>
            )}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Warning: If you forget your master password, your data cannot be
            recovered.
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
  return (
    <div className="flex items-center justify-center h-full p-8">
      <div className="max-w-md w-full space-y-6">
        <div className="text-center space-y-2">
          <Lock className="h-16 w-16 mx-auto text-primary" />
          <h2 className="text-2xl font-semibold">Vault Locked</h2>
          <p className="text-muted-foreground">
            Enter your master password to unlock the vault and access your
            secure data.
          </p>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="unlock-password">Master Password</Label>
            <div className="relative">
              <Input
                id="unlock-password"
                type={props.showPassword ? 'text' : 'password'}
                value={props.password}
                onChange={event => props.onPasswordChange(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter') props.onUnlock()
                }}
                placeholder="Enter your master password"
              />
              <PasswordVisibilityButton
                visible={props.showPassword}
                onChange={props.onShowPasswordChange}
              />
            </div>
          </div>
          <VaultError error={props.error} />
          <Button className="w-full" onClick={props.onUnlock}>
            <Unlock className="h-4 w-4 mr-2" />
            Unlock Vault
          </Button>
        </div>
      </div>
    </div>
  )
}
