import { Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface GenerateKeyFormProps {
  keyType: string
  comment: string
  passphrase: string
  confirmPassphrase: string
  showPassphrase: boolean
  onKeyTypeChange: (value: string) => void
  onCommentChange: (value: string) => void
  onPassphraseChange: (value: string) => void
  onConfirmPassphraseChange: (value: string) => void
  onTogglePassphrase: () => void
}

export function GenerateKeyForm({
  keyType,
  comment,
  passphrase,
  confirmPassphrase,
  showPassphrase,
  onKeyTypeChange,
  onCommentChange,
  onPassphraseChange,
  onConfirmPassphraseChange,
  onTogglePassphrase,
}: GenerateKeyFormProps) {
  const { t } = useTranslation()
  return (
    <>
      <div>
        <Label htmlFor="gen-type">{t('keychain.keyType')}</Label>
        <Select value={keyType} onValueChange={onKeyTypeChange}>
          <SelectTrigger id="gen-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ed25519">
              {t('keychain.ed25519Recommended')}
            </SelectItem>
            <SelectItem value="rsa4096">{t('keychain.rsa4096')}</SelectItem>
            <SelectItem value="rsa">{t('keychain.rsa2048')}</SelectItem>
            <SelectItem value="ecdsa-nistp256">ECDSA P-256</SelectItem>
            <SelectItem value="ecdsa-nistp384">ECDSA P-384</SelectItem>
            <SelectItem value="ecdsa-nistp521">ECDSA P-521</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="gen-comment">{t('keychain.commentLabel')}</Label>
        <Input
          id="gen-comment"
          placeholder="user@hostname"
          value={comment}
          onChange={e => onCommentChange(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="gen-passphrase">
          {t('keychain.passphraseOptional')}
        </Label>
        <div className="relative">
          <Input
            id="gen-passphrase"
            type={showPassphrase ? 'text' : 'password'}
            placeholder={t('keychain.enterPassphrase')}
            value={passphrase}
            onChange={e => onPassphraseChange(e.target.value)}
          />
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 size-7"
            onClick={onTogglePassphrase}
          >
            {showPassphrase ? (
              <EyeOff className="size-4" />
            ) : (
              <Eye className="size-4" />
            )}
          </Button>
        </div>
      </div>

      <div>
        <Label htmlFor="gen-confirm-passphrase">
          {t('keychain.confirmPassphrase')}
        </Label>
        <Input
          id="gen-confirm-passphrase"
          type={showPassphrase ? 'text' : 'password'}
          placeholder={t('keychain.confirmPassphrasePlaceholder')}
          value={confirmPassphrase}
          onChange={e => onConfirmPassphraseChange(e.target.value)}
        />
      </div>
    </>
  )
}
