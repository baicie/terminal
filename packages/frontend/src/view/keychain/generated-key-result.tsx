import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

export interface GeneratedKeyResult {
  private_key: string
  public_key: string
  key_type: string
  fingerprint: string
}

interface GeneratedKeyResultViewProps {
  result: GeneratedKeyResult
  showPrivateKey: boolean
  onTogglePrivateKey: () => void
  onCopy: (text: string, label: string) => void
}

export function GeneratedKeyResultView({
  result,
  showPrivateKey,
  onTogglePrivateKey,
  onCopy,
}: GeneratedKeyResultViewProps) {
  return (
    <>
      <div className="rounded-md bg-green-500/10 border border-green-500/30 p-3 text-sm text-green-600 dark:text-green-400">
        Key generated successfully! Type: {result.key_type}
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Fingerprint</Label>
          <span className="text-xs text-muted-foreground font-mono truncate ml-2">
            {result.fingerprint}
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
            onClick={() => onCopy(result.public_key, 'Public key')}
          >
            Copy
          </Button>
        </div>
        <Textarea
          readOnly
          value={result.public_key}
          className="h-20 font-mono text-xs"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <Label>Private Key</Label>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={onTogglePrivateKey}
            >
              {showPrivateKey ? (
                <EyeOff className="size-3" />
              ) : (
                <Eye className="size-3" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => onCopy(result.private_key, 'Private key')}
            >
              Copy
            </Button>
          </div>
        </div>
        <Textarea
          readOnly
          value={
            showPrivateKey
              ? result.private_key
              : '•••••••••••••••••••••••••••••••'
          }
          className="h-32 font-mono text-xs"
        />
        <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">
          Store your private key securely. Anyone with this key can access your
          servers.
        </p>
      </div>
    </>
  )
}
