import type { Host } from '@/types'
import { AlertTriangle, Lock, Shield } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { toast } from '@/components/ui/sonner'
import { Switch } from '@/components/ui/switch'
import {
  readHostSecretsForShare,
  shareKindsFor,
} from '@/service/share-host-secrets'
import { createShareableTeamHostData } from '@/service/team-host-data'
import {
  encryptWithPassword,
  validatePasswordStrength,
} from '@/utils/team-encryption'

interface ShareHostDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  host: Host | null
  onShare: (
    hostData: Record<string, unknown>,
    permission: 'readonly' | 'readwrite',
  ) => Promise<void>
}

export function ShareHostDialog({
  open,
  onOpenChange,
  host,
  onShare,
}: ShareHostDialogProps) {
  const { t } = useTranslation()
  const [permission, setPermission] = useState<'readonly' | 'readwrite'>(
    'readonly',
  )
  const [includePassword, setIncludePassword] = useState(false)
  const [encryptPassword, setEncryptPassword] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleShare = async () => {
    if (!host) return

    setLoading(true)
    try {
      const hostData = createShareableTeamHostData(host)

      // Credentials are not on the row any more — they live in the vault behind
      // `credentialRef`. Reading `host.password` here (as this dialog used to)
      // was permanently false, so "share with credentials" shared nothing and
      // still reported success. Read the real values, through the reference.
      const kinds = shareKindsFor(host.credentialRef ?? null, includePassword)
      if (kinds.length > 0) {
        const read = await readHostSecretsForShare(host.id, host.credentialRef ?? null, kinds)
        if (!read.ok) {
          // Nothing was shared, so nothing may claim it was.
          toast.error(read.message)
          return
        }

        // Rule: a secret only ever travels encrypted. Sharing it in the clear was
        // previously possible behind a warning; that path is gone, because a
        // warning does not make a plaintext password on a server acceptable.
        if (!encryptPassword || !password) {
          toast.error(t('hosts.share.encryptionRequired'))
          return
        }

        if (read.secrets.password !== undefined) {
          const encrypted = await encryptWithPassword(read.secrets.password, password)
          hostData.password_encrypted = { ...encrypted, original: undefined }
          hostData._encrypted = true
        }
        if (read.secrets.privateKey !== undefined) {
          const encrypted = await encryptWithPassword(read.secrets.privateKey, password)
          hostData.private_key_encrypted = { ...encrypted, original: undefined }
          hostData._encrypted = true
        }
        if (read.secrets.passphrase !== undefined) {
          const encrypted = await encryptWithPassword(read.secrets.passphrase, password)
          hostData.passphrase_encrypted = { ...encrypted, original: undefined }
          hostData._encrypted = true
        }
      }

      await onShare(hostData, permission)
      toast.success(t('teams.shareHost'))

      // Reset form
      setPassword('')
      setConfirmPassword('')
      setIncludePassword(false)
      setEncryptPassword(false)
      onOpenChange(false)
    } catch (error) {
      toast.error(String(error))
    } finally {
      setLoading(false)
    }
  }

  const passwordStrength = password ? validatePasswordStrength(password) : null
  const passwordsMatch = password === confirmPassword

  if (!host) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Shield className="size-5" />
            {t('teams.shareHost')}
          </DialogTitle>
          <DialogDescription>{t('teams.shareHostDesc')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Host Info */}
          <div className="p-3 bg-muted rounded-lg">
            <div className="font-medium">{host.name}</div>
            <div className="text-sm text-muted-foreground">
              {host.username}@{host.hostname}:{host.port}
            </div>
          </div>

          {/* Permission Selection */}
          <div className="space-y-2">
            <Label>{t('teams.permissions')}</Label>
            <Select
              value={permission}
              onValueChange={v => setPermission(v as typeof permission)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="readonly">
                  <div className="flex items-center gap-2">
                    <span>{t('teams.readonly')}</span>
                    <span className="text-xs text-muted-foreground">
                      - {t('teams.readonlyDesc')}
                    </span>
                  </div>
                </SelectItem>
                <SelectItem value="readwrite">
                  <div className="flex items-center gap-2">
                    <span>{t('teams.readwrite')}</span>
                    <span className="text-xs text-muted-foreground">
                      - {t('teams.readwriteDesc')}
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Include Password Option */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="include-password" className="cursor-pointer">
                {t('teams.includePassword')}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t('teams.includePasswordDesc')}
              </p>
            </div>
            <Switch
              id="include-password"
              checked={includePassword}
              onCheckedChange={setIncludePassword}
            />
          </div>

          {includePassword && (
            <div className="space-y-3 pl-4 border-l-2 border-primary/20">
              {/* Encrypt Password */}
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="encrypt-password"
                    className="cursor-pointer flex items-center gap-1"
                  >
                    <Lock className="size-3" />
                    {t('teams.encryptPassword')}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t('teams.encryptPasswordDesc')}
                  </p>
                </div>
                <Switch
                  id="encrypt-password"
                  checked={encryptPassword}
                  onCheckedChange={setEncryptPassword}
                />
              </div>

              {encryptPassword && (
                <div className="space-y-3 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                    <div className="text-xs text-amber-500/80">
                      {t('teams.encryptionHint')}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="share-password">
                        {t('teams.sharePassword')}
                      </Label>
                      <Input
                        id="share-password"
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder={t('teams.enterSharePassword')}
                      />
                      {passwordStrength && !passwordStrength.valid && (
                        <p className="text-xs text-amber-500">
                          {passwordStrength.message}
                        </p>
                      )}
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="confirm-password">
                        {t('teams.confirmPassword')}
                      </Label>
                      <Input
                        id="confirm-password"
                        type="password"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        placeholder={t('teams.confirmPassword')}
                      />
                      {confirmPassword && !passwordsMatch && (
                        <p className="text-xs text-destructive">
                          {t('teams.passwordsNotMatch')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {!encryptPassword && host.password && (
                <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
                    <div className="text-xs text-destructive/80">
                      {t('teams.plaintextPasswordWarning')}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleShare}
            disabled={
              loading ||
              (encryptPassword && (!passwordsMatch || !passwordStrength?.valid))
            }
          >
            {loading ? t('common.loading') : t('teams.share')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
