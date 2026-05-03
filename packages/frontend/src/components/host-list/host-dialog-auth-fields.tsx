import type { AuthType } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface AuthFieldsProps {
  authType: AuthType
  password: string | undefined
  privateKey: string | undefined
  certificate: string | undefined
  onPasswordChange: (v: string) => void
  onPrivateKeyChange: (v: string) => void
  onCertificateChange: (v: string) => void
}

async function browseFile(
  accept: string[],
  onPick: (content: string) => void,
) {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      multiple: false,
      filters: [{ name: 'SSH Keys / Certificates', extensions: accept }],
    })
    if (selected) {
      const { readTextFile } = await import('@tauri-apps/plugin-fs')
      const content = await readTextFile(selected as string)
      onPick(content)
    }
  } catch (e) {
    console.error('Failed to open file dialog:', e)
  }
}

export function AuthFields({
  authType,
  password,
  privateKey,
  certificate,
  onPasswordChange,
  onPrivateKeyChange,
  onCertificateChange,
}: AuthFieldsProps) {
  return (
    <>
      {authType === 'password' && (
        <div className="col-span-2">
          <Label htmlFor="password" className="text-sm font-medium mb-1 block">
            Password
          </Label>
          <Input
            id="password"
            type="password"
            value={password ?? ''}
            onChange={e => onPasswordChange(e.target.value)}
            placeholder="••••••••"
          />
        </div>
      )}

      {authType === 'key' && (
        <>
          <div className="col-span-2">
            <Label htmlFor="privateKey" className="text-sm font-medium mb-1 block">
              Private Key
            </Label>
            <div className="flex gap-2">
              <Textarea
                id="privateKey"
                className="flex-1 font-mono min-h-[120px]"
                value={privateKey ?? ''}
                onChange={e => onPrivateKeyChange(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              />
              <Button
                variant="outline"
                onClick={() =>
                  browseFile(['pem', 'key', 'ppk', '*'], onPrivateKeyChange)
                }
              >
                Browse
              </Button>
            </div>
          </div>
          <div className="col-span-2">
            <Label htmlFor="passphrase" className="text-sm font-medium mb-1 block">
              Key Passphrase (optional)
            </Label>
            <Input
              id="passphrase"
              type="password"
              value={password ?? ''}
              onChange={e => onPasswordChange(e.target.value)}
              placeholder="••••••••"
            />
          </div>
        </>
      )}

      {authType === 'agent' && (
        <div className="col-span-2 rounded-md border border-border bg-muted/30 p-3">
          <p className="text-sm text-muted-foreground">
            Uses your system SSH agent (e.g., ssh-agent, Pageant, Windows OpenSSH
            Agent) for authentication. No password or key file required.
          </p>
        </div>
      )}

      {authType === 'cert' && (
        <>
          <div className="col-span-2">
            <Label htmlFor="certificate" className="text-sm font-medium mb-1 block">
              SSH Certificate
            </Label>
            <div className="flex gap-2">
              <Textarea
                id="certificate"
                className="flex-1 font-mono min-h-[120px]"
                value={certificate ?? ''}
                onChange={e => onCertificateChange(e.target.value)}
                placeholder="-----BEGIN OPENSSH CERTIFICATE-----"
              />
              <Button
                variant="outline"
                onClick={() =>
                  browseFile(['crt', 'cert', '*'], onCertificateChange)
                }
              >
                Browse
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              OpenSSH user certificate (base64-encoded, signed by a CA key)
            </p>
          </div>
          <div className="col-span-2">
            <Label htmlFor="signingKey" className="text-sm font-medium mb-1 block">
              Signing Private Key
            </Label>
            <div className="flex gap-2">
              <Textarea
                id="signingKey"
                className="flex-1 font-mono min-h-[100px]"
                value={privateKey ?? ''}
                onChange={e => onPrivateKeyChange(e.target.value)}
                placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              />
              <Button
                variant="outline"
                onClick={() =>
                  browseFile(['pem', 'key', 'ppk', '*'], onPrivateKeyChange)
                }
              >
                Browse
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Private key used to present the certificate to the server
            </p>
          </div>
          <div className="col-span-2">
            <Label htmlFor="keyPassphrase" className="text-sm font-medium mb-1 block">
              Key Passphrase (optional)
            </Label>
            <Input
              id="keyPassphrase"
              type="password"
              value={password ?? ''}
              onChange={e => onPasswordChange(e.target.value)}
              placeholder="••••••••"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Passphrase for the signing private key
            </p>
          </div>
        </>
      )}
    </>
  )
}
