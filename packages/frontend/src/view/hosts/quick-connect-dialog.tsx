import type { AuthType, Host } from '@/types'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AuthFields } from '@/components/host-list/host-dialog-auth-fields'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { QuickConnectTarget } from './quick-connect-parser'

export type QuickConnectProfileDraft = Omit<
  Host,
  'id' | 'createdAt' | 'updatedAt'
>

interface QuickConnectDialogProps {
  open: boolean
  target: QuickConnectTarget | null
  onOpenChange: (open: boolean) => void
  onConnect: (profile: QuickConnectProfileDraft) => void
}

export function QuickConnectDialog({
  open,
  target,
  onOpenChange,
  onConnect,
}: QuickConnectDialogProps) {
  const { t } = useTranslation()
  const [username, setUsername] = useState('')
  const [authType, setAuthType] = useState<AuthType>('password')
  const [password, setPassword] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [certificate, setCertificate] = useState('')
  const [validationError, setValidationError] = useState<string | null>(null)

  useEffect(() => {
    setUsername(target?.username ?? '')
    setAuthType('password')
    setPassword('')
    setPrivateKey('')
    setCertificate('')
    setValidationError(null)
  }, [open, target?.hostname, target?.port, target?.username])

  const handleSubmit = () => {
    if (!target) return
    const normalizedUsername = username.trim()
    if (!normalizedUsername) {
      setValidationError(t('quickConnect.usernameRequired'))
      return
    }
    if (authType === 'password' && !password) {
      setValidationError(t('quickConnect.passwordRequired'))
      return
    }
    if ((authType === 'key' || authType === 'cert') && !privateKey.trim()) {
      setValidationError(t('quickConnect.privateKeyRequired'))
      return
    }
    if (authType === 'cert' && !certificate.trim()) {
      setValidationError(t('quickConnect.certificateRequired'))
      return
    }

    onConnect({
      name: `${normalizedUsername}@${target.hostname}`,
      hostname: target.hostname,
      port: target.port,
      username: normalizedUsername,
      authType,
      password: password || undefined,
      privateKey: privateKey || undefined,
      certificate: certificate || undefined,
      isFavorite: false,
      portForwards: [],
      agentForwarding: false,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('quickConnect.title')}</DialogTitle>
          <DialogDescription>
            {target
              ? t('quickConnect.description', {
                  hostname: target.hostname,
                  port: target.port,
                })
              : t('quickConnect.descriptionEmpty')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2 sm:col-span-1">
            <Label htmlFor="quick-connect-username">
              {t('hostDialog.username')}
            </Label>
            <Input
              id="quick-connect-username"
              autoComplete="username"
              value={username}
              aria-invalid={!username.trim() && validationError !== null}
              onChange={event => {
                setUsername(event.target.value)
                setValidationError(null)
              }}
            />
          </div>

          <div className="col-span-2 sm:col-span-1">
            <Label htmlFor="quick-connect-auth">
              {t('hostDialog.authentication')}
            </Label>
            <Select
              value={authType}
              onValueChange={value => {
                setAuthType(value as AuthType)
                setValidationError(null)
              }}
            >
              <SelectTrigger id="quick-connect-auth" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="password">
                    {t('hostDialog.passwordAuth')}
                  </SelectItem>
                  <SelectItem value="key">
                    {t('hostDialog.sshKeyAuth')}
                  </SelectItem>
                  <SelectItem value="agent">
                    {t('hostDialog.sshAgentAuth')}
                  </SelectItem>
                  <SelectItem value="cert">
                    {t('quickConnect.certificateAuth')}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <AuthFields
            authType={authType}
            password={password}
            privateKey={privateKey}
            certificate={certificate}
            onPasswordChange={value => {
              setPassword(value)
              setValidationError(null)
            }}
            onPrivateKeyChange={value => {
              setPrivateKey(value)
              setValidationError(null)
            }}
            onCertificateChange={value => {
              setCertificate(value)
              setValidationError(null)
            }}
          />
        </div>

        {validationError ? (
          <p role="alert" className="text-sm text-destructive">
            {validationError}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSubmit}>{t('hosts.connect')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
