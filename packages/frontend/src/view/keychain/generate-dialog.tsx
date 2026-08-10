import { Loader2, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { ResponsiveDialog } from '@/components/ui/responsive-dialog'
import { toast } from '@/components/ui/sonner'
import { sshService } from '@/service/ssh'
import { GenerateKeyForm } from './generate-key-form'
import {
  GeneratedKeyResultView,
  type GeneratedKeyResult,
} from './generated-key-result'

interface GenerateKeyDialogProps {
  open: boolean
  onClose: () => void
  onUseKey: (result: GeneratedKeyResult) => void
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
  const [generatedResult, setGeneratedResult] =
    useState<GeneratedKeyResult | null>(null)
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
        genKeyType as
          | 'ed25519'
          | 'rsa'
          | 'rsa4096'
          | 'ecdsa'
          | 'ecdsa-nistp256'
          | 'ecdsa-nistp384'
          | 'ecdsa-nistp521',
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
    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast.success(`${label} copied to clipboard`)
      })
      .catch(() => {
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
              <Button
                variant="outline"
                onClick={() => setGeneratedResult(null)}
              >
                Generate Another
              </Button>
              <Button
                onClick={() => {
                  if (generatedResult) onUseKey(generatedResult)
                  handleClose()
                }}
              >
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
        <GenerateKeyForm
          keyType={genKeyType}
          comment={genComment}
          passphrase={genPassphrase}
          confirmPassphrase={genConfirmPassphrase}
          showPassphrase={showGenPassphrase}
          onKeyTypeChange={setGenKeyType}
          onCommentChange={setGenComment}
          onPassphraseChange={setGenPassphrase}
          onConfirmPassphraseChange={setGenConfirmPassphrase}
          onTogglePassphrase={() => setShowGenPassphrase(!showGenPassphrase)}
        />
      ) : (
        <GeneratedKeyResultView
          result={generatedResult}
          showPrivateKey={showPrivateKey}
          onTogglePrivateKey={() => setShowPrivateKey(!showPrivateKey)}
          onCopy={handleCopyToClipboard}
        />
      )}
    </ResponsiveDialog>
  )
}
