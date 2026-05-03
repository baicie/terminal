import type { AuthType } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface AuthFieldsProps {
  authType: AuthType
  password: string | undefined
  privateKey: string | undefined
  onPasswordChange: (v: string) => void
  onPrivateKeyChange: (v: string) => void
}

export function AuthFields({
  authType,
  password,
  privateKey,
  onPasswordChange,
  onPrivateKeyChange,
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
                onClick={async () => {
                  try {
                    const { open } = await import(
                      '@tauri-apps/plugin-dialog'
                    )
                    const selected = await open({
                      multiple: false,
                      filters: [
                        {
                          name: 'SSH Keys',
                          extensions: ['pem', 'key', 'ppk', '*'],
                        },
                      ],
                    })
                    if (selected) {
                      const { readTextFile } = await import(
                        '@tauri-apps/plugin-fs'
                      )
                      const content = await readTextFile(selected as string)
                      onPrivateKeyChange(content)
                    }
                  } catch (e) {
                    console.error('Failed to open file dialog:', e)
                  }
                }}
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
            Uses your system SSH agent (e.g., ssh-agent, Pageant, Windows OpenSSH Agent) for authentication.
            No password or key file required.
          </p>
        </div>
      )}
    </>
  )
}
