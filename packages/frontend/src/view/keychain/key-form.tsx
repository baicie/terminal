import type { SSHKeyRecord } from '@/service/database'
import { FileKey, KeyRound, Shield } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

interface KeyFormProps {
  selectedKey: SSHKeyRecord | null
  isNewKey: boolean
  formName: string
  formKeyType: string
  formPrivateKey: string
  formPublicKey: string
  formCertificate: string
  formPassphrase: string
  onFormChange: (field: string, value: string) => void
  onImportFromFile: (field: 'private' | 'public' | 'certificate') => void
  onSave: () => void
  onDelete: () => void
  onNewKey: () => void
}

export const KeyForm: React.FC<KeyFormProps> = ({
  selectedKey,
  isNewKey,
  formName,
  formKeyType,
  formPrivateKey,
  formPublicKey,
  formCertificate,
  formPassphrase,
  onFormChange,
  onImportFromFile,
  onSave,
  onDelete,
}) => {
  const { t } = useTranslation()
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-md bg-primary/10 text-primary">
          {formKeyType === 'certificate' ? <Shield className="size-5" /> : <KeyRound className="size-5" />}
        </div>
        <span className="font-semibold">
          {isNewKey ? t('keychain.newKey') : t('keychain.editKey')}
        </span>
      </div>

      <div className="max-w-2xl space-y-6">
        <div className="space-y-2">
          <Label htmlFor="name">{t('keychain.labelRequired')}</Label>
          <Input
            id="name"
            placeholder={t('keychain.labelPlaceholder')}
            value={formName}
            onChange={e => onFormChange('name', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>{t('keychain.keyType')}</Label>
          <Select value={formKeyType} onValueChange={v => onFormChange('keyType', v)}>
            <SelectTrigger>
              <SelectValue placeholder={t('keychain.selectKeyType')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="key">KEY</SelectItem>
              <SelectItem value="certificate">
                {t('keychain.certificate')}
              </SelectItem>
              <SelectItem value="touchid">{t('keychain.touchId')}</SelectItem>
              <SelectItem value="fido2">{t('keychain.fido2')}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {formKeyType === 'key' || formKeyType === 'certificate' ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="privateKey">
                  {t('keychain.privateKeyRequired')}
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onImportFromFile('private')}
                >
                  <FileKey className="size-4 mr-1" data-icon="inline-start" />
                  {t('keychain.importFromFile')}
                </Button>
              </div>
              <Textarea
                id="privateKey"
                placeholder={t('keychain.privateKeyPlaceholder')}
                value={formPrivateKey}
                onChange={e => onFormChange('privateKey', e.target.value)}
                className="font-mono text-xs h-32"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="publicKey">{t('keychain.publicKey')}</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onImportFromFile('public')}
                >
                  <FileKey className="size-4 mr-1" data-icon="inline-start" />
                  {t('keychain.importFromFile')}
                </Button>
              </div>
              <Textarea
                id="publicKey"
                placeholder={t('keychain.publicKeyPlaceholder')}
                value={formPublicKey}
                onChange={e => onFormChange('publicKey', e.target.value)}
                className="font-mono text-xs h-24"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="passphrase">{t('keychain.passphrase')}</Label>
              <Input
                id="passphrase"
                type="password"
                placeholder={t('keychain.passphrasePlaceholder')}
                value={formPassphrase}
                onChange={e => onFormChange('passphrase', e.target.value)}
              />
            </div>
          </>
        ) : null}

        {formKeyType === 'certificate' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="certificate">
                {t('keychain.certificate')}
              </Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onImportFromFile('certificate')}
              >
                <FileKey className="size-4 mr-1" data-icon="inline-start" />
                {t('keychain.importFromFile')}
              </Button>
            </div>
            <Textarea
              id="certificate"
              placeholder={t('keychain.certificatePlaceholder')}
              value={formCertificate}
              onChange={e => onFormChange('certificate', e.target.value)}
              className="font-mono text-xs h-24"
            />
          </div>
        )}

        {!isNewKey && selectedKey && (
          <div className="pt-4 border-t">
            <div className="text-xs text-muted-foreground space-y-1">
              <div>
                {t('keychain.created', {
                  date: new Date(selectedKey.created_at).toLocaleDateString(),
                })}
              </div>
              <div>
                {t('keychain.updated', {
                  date: new Date(selectedKey.updated_at).toLocaleDateString(),
                })}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {!isNewKey && selectedKey && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              {t('common.delete')}
            </Button>
          )}
          <Button size="sm" onClick={onSave} disabled={!formName.trim()}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </>
  )
}
