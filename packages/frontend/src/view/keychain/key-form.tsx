import type { SSHKeyRecord } from '@/service/database'
import { FileKey, KeyRound, Shield } from 'lucide-react'
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
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="p-2 rounded-md bg-primary/10 text-primary">
          {formKeyType === 'certificate' ? <Shield className="size-5" /> : <KeyRound className="size-5" />}
        </div>
        <span className="font-semibold">
          {isNewKey ? 'New Key' : 'Edit Key'}
        </span>
      </div>

      <div className="max-w-2xl space-y-6">
        <div className="space-y-2">
          <Label htmlFor="name">Label *</Label>
          <Input
            id="name"
            placeholder="Add a label..."
            value={formName}
            onChange={e => onFormChange('name', e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Key Type</Label>
          <Select value={formKeyType} onValueChange={v => onFormChange('keyType', v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select key type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="key">KEY</SelectItem>
              <SelectItem value="certificate">Certificate</SelectItem>
              <SelectItem value="touchid">Touch ID</SelectItem>
              <SelectItem value="fido2">FIDO2</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {formKeyType === 'key' || formKeyType === 'certificate' ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="privateKey">Private Key *</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onImportFromFile('private')}
                >
                  <FileKey className="size-4 mr-1" data-icon="inline-start" />
                  Import from file
                </Button>
              </div>
              <Textarea
                id="privateKey"
                placeholder="Paste private key content or import from file..."
                value={formPrivateKey}
                onChange={e => onFormChange('privateKey', e.target.value)}
                className="font-mono text-xs h-32"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="publicKey">Public Key</Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onImportFromFile('public')}
                >
                  <FileKey className="size-4 mr-1" data-icon="inline-start" />
                  Import from file
                </Button>
              </div>
              <Textarea
                id="publicKey"
                placeholder="Paste public key content..."
                value={formPublicKey}
                onChange={e => onFormChange('publicKey', e.target.value)}
                className="font-mono text-xs h-24"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="passphrase">Passphrase</Label>
              <Input
                id="passphrase"
                type="password"
                placeholder="Enter passphrase for encrypted key..."
                value={formPassphrase}
                onChange={e => onFormChange('passphrase', e.target.value)}
              />
            </div>
          </>
        ) : null}

        {formKeyType === 'certificate' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="certificate">Certificate</Label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onImportFromFile('certificate')}
              >
                <FileKey className="size-4 mr-1" data-icon="inline-start" />
                Import from file
              </Button>
            </div>
            <Textarea
              id="certificate"
              placeholder="Paste certificate content..."
              value={formCertificate}
              onChange={e => onFormChange('certificate', e.target.value)}
              className="font-mono text-xs h-24"
            />
          </div>
        )}

        {!isNewKey && selectedKey && (
          <div className="pt-4 border-t">
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Created: {new Date(selectedKey.created_at).toLocaleDateString()}</div>
              <div>Updated: {new Date(selectedKey.updated_at).toLocaleDateString()}</div>
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
              Delete
            </Button>
          )}
          <Button size="sm" onClick={onSave} disabled={!formName.trim()}>
            Save
          </Button>
        </div>
      </div>
    </>
  )
}
