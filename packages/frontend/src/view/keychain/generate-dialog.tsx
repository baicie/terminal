import { Loader2, Wand2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()
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
      toast.error(t('keychain.passphrasesNotMatch'))
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
      toast.success(t('keychain.keyGenerated'))
    } catch (error) {
      toast.error(t('keychain.generateFailed', { error: String(error) }))
    } finally {
      setGenerating(false)
    }
  }

  const handleCopyToClipboard = (text: string, label: string) => {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        toast.success(t('keychain.copiedToClipboard', { label }))
      })
      .catch(() => {
        toast.error(t('keychain.copyFailed'))
      })
  }

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={handleClose}
      header={
        <div className="flex items-center gap-2">
          <Wand2 className="size-5" />
          <span className="font-semibold">{t('keychain.generateTitle')}</span>
        </div>
      }
      footer={
        <div className="flex gap-2">
          {!generatedResult ? (
            <>
              <Button variant="outline" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <Button onClick={handleGenerateKey} disabled={generating}>
                {generating ? (
                  <>
                    <Loader2 className="size-4 mr-1 animate-spin" />
                    {t('keychain.generating')}
                  </>
                ) : (
                  <>
                    <Wand2 className="size-4 mr-1" data-icon="inline-start" />
                    {t('keychain.generateKey')}
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
                {t('keychain.generateAnother')}
              </Button>
              <Button
                onClick={() => {
                  if (generatedResult) onUseKey(generatedResult)
                  handleClose()
                }}
              >
                {t('keychain.useThisKey')}
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
