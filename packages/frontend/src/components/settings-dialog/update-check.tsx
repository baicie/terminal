import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { checkForUpdates, type UpdateStatus } from '@/service/updates'

function describeStatus(status: UpdateStatus, currentVersion: string): string {
  switch (status.status) {
    case 'unsupported':
      return 'Update checks are only available in the desktop app.'
    case 'unconfigured':
      return `Updater is not configured in this build: ${status.detail}`
    case 'up-to-date':
      return `You are on the latest version (${status.version}).`
    case 'available':
      return `Version ${status.version} is available (current ${currentVersion}). Installing updates is not wired to a button yet, so download it from the release page.`
    case 'error':
      return `Update check failed: ${status.detail}`
  }
}

const UpdateCheck: React.FC = () => {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)

  const run = async () => {
    setChecking(true)
    try {
      setStatus(await checkForUpdates())
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-3">
      <Separator />
      <div className="space-y-2">
        <p className="text-sm font-medium">Updates</p>
        <p className="text-xs text-muted-foreground">
          This build ships without Apple or Windows code signing. An update
          check verifies the Tauri updater signature of the manifest, which
          fails closed while the public key is still a placeholder.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={run}
          disabled={checking}
        >
          {checking ? 'Checking…' : 'Check for updates'}
        </Button>
        {status ? (
          <p className="text-xs text-muted-foreground" role="status">
            {describeStatus(status, 'this build')}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export { UpdateCheck }
