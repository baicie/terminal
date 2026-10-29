import { Eye, EyeOff } from 'lucide-react'
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
  return (
    <>
      <div>
        <Label htmlFor="gen-type">Key Type</Label>
        <Select value={keyType} onValueChange={onKeyTypeChange}>
          <SelectTrigger id="gen-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ed25519">Ed25519 (Recommended)</SelectItem>
            <SelectItem value="rsa4096">RSA 4096-bit</SelectItem>
            <SelectItem value="rsa">RSA 2048-bit</SelectItem>
            <SelectItem value="ecdsa-nistp256">ECDSA P-256</SelectItem>
            <SelectItem value="ecdsa-nistp384">ECDSA P-384</SelectItem>
            <SelectItem value="ecdsa-nistp521">ECDSA P-521</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label htmlFor="gen-comment">Comment / Label</Label>
        <Input
          id="gen-comment"
          placeholder="user@hostname"
          value={comment}
          onChange={e => onCommentChange(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor="gen-passphrase">Passphrase (optional)</Label>
        <div className="relative">
          <Input
            id="gen-passphrase"
            type={showPassphrase ? 'text' : 'password'}
            placeholder="Enter passphrase"
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
        <Label htmlFor="gen-confirm-passphrase">Confirm Passphrase</Label>
        <Input
          id="gen-confirm-passphrase"
          type={showPassphrase ? 'text' : 'password'}
          placeholder="Confirm passphrase"
          value={confirmPassphrase}
          onChange={e => onConfirmPassphraseChange(e.target.value)}
        />
      </div>
    </>
  )
}
