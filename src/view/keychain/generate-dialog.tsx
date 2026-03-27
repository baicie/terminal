import { Eye, EyeOff, Loader2, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ResponsiveDialog } from '@/components/ui/responsive-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/sonner'
import { sshService } from '@/service/ssh'

interface GenerateKeyDialogProps {
  open: boolean
  onClose: () => void
  onUseKey: (result: {
    private_key: string
    public_key: string
    key_type: string
    fingerprint: string
  }) => void
}

export const GenerateKeyDialog: React.FC<GenerateKeyDialogProps> = ({
  open,
  onClose,
  onUseKey,
}) => {
  const [genKeyType, setGenKeyType] = useState('ed25519')
  const [genComment, setGenComment] = useState('')
  const [genPassphrase, setGenPassphrase] = useState('')
  const [genConfirmPassphrase, setGenConfirmPassphrase] = useState('')
  const [showGenPassphrase, setShowGenPassphrase] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generatedResult, setGeneratedResult] = useState<{
    private_key: string
    public_key: string
    key_type: string
    fingerprint: string
  } | null>(null)
  const [showPrivateKey, setShowPrivateKey] = useState(false)

  const handleClose = () => {
    setGeneratedResult(null)
    setGenComment('')
    setGenPassphrase('')
    setGenConfirmPassphrase('')
    setShowGenPassphrase(false)
    onClose()
  }

  const handleGenerateKey = async () => {
    if (genPassphrase !== genConfirmPassphrase) {
      toast.error('Passphrases do not match')
      return
    }
    setGenerating(true)
    try {
      const result = await sshService.generateSSHKey(
        genKeyType as 'ed25519' | 'rsa' | 'rsa4096' | 'ecdsa' | 'ecdsa-nistp256' | 'ecdsa-nistp384' | 'ecdsa-nistp521',
        genComment,
        genPassphrase || undefined,
      )
      setGeneratedResult(result)
      toast.success('Key generated successfully')
    } catch (error) {
      toast.error(`Failed to generate key: ${error}`)
    } finally {
      setGenerating(false)
    }
  }

  const handleCopyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(`${label} copied to clipboard`)
    }).catch(() => {
      toast.error('Failed to copy')
    })
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleClose}
      header={
        <div className="flex items-center gap-2">
          <Wand2 className="size-5" />
          <span className="font-semibold">Generate SSH Key</span>
        </div>
      }
      footer={
        <div className="flex gap-2">
          {!generatedResult ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button onClick={handleGenerateKey} disabled={generating}>
                {generating ? (
                  <>
                    <Loader2 className="size-4 mr-1 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Wand2 className="size-4 mr-1" data-icon="inline-start" />
                    Generate Key
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => setGeneratedResult(null)}>
                Generate Another
              </Button>
              <Button onClick={() => { if (generatedResult) onUseKey(generatedResult); handleClose() }}>
                Use This Key
              </Button>
            </>
          )}
        </div>
      }
      contentClassName="space-y-4"
      mobileHeight="85dvh"
    >
      {!generatedResult ? (
        <>
          <div>
            <Label htmlFor="gen-type">Key Type</Label>
            <Select value={genKeyType} onValueChange={setGenKeyType}>
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
              value={genComment}
              onChange={e => setGenComment(e.target.value)}
            />
          </div>

          <div>
            <Label htmlFor="gen-passphrase">Passphrase (optional)</Label>
            <div className="relative">
              <Input
                id="gen-passphrase"
                type={showGenPassphrase ? 'text' : 'password'}
                placeholder="Enter passphrase"
                value={genPassphrase}
                onChange={e => setGenPassphrase(e.target.value)}
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 size-7"
                onClick={() => setShowGenPassphrase(!showGenPassphrase)}
              >
                {showGenPassphrase ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            </div>
          </div>

          <div>
            <Label htmlFor="gen-confirm-passphrase">Confirm Passphrase</Label>
            <Input
              id="gen-confirm-passphrase"
              type={showGenPassphrase ? 'text' : 'password'}
              placeholder="Confirm passphrase"
              value={genConfirmPassphrase}
              onChange={e => setGenConfirmPassphrase(e.target.value)}
            />
          </div>
        </>
      ) : (
        <>
          <div className="rounded-md bg-green-500/10 border border-green-500/30 p-3 text-sm text-green-600 dark:text-green-400">
            Key generated successfully! Type: {generatedResult.key_type}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Fingerprint</Label>
              <span className="text-xs text-muted-foreground font-mono truncate ml-2">
                {generatedResult.fingerprint}
              </span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Public Key</Label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => handleCopyToClipboard(generatedResult.public_key, 'Public key')}
              >
                Copy
              </Button>
            </div>
            <Textarea readOnly value={generatedResult.public_key} className="h-20 font-mono text-xs" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Private Key</Label>
              <div className="flex gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => setShowPrivateKey(!showPrivateKey)}
                >
                  {showPrivateKey ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={() => handleCopyToClipboard(generatedResult.private_key, 'Private key')}
                >
                  Copy
                </Button>
              </div>
            </div>
            <Textarea
              readOnly
              value={showPrivateKey ? generatedResult.private_key : '•••••••••••••••••••••••••••••••'}
              className="h-32 font-mono text-xs"
            />
            <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
              Store your private key securely. Anyone with this key can access your servers.
            </p>
          </div>
        </>
      )}
    </ResponsiveDialog>
  )
}
