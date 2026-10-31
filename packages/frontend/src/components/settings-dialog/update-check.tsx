import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  checkForUpdates,
  isUpdateFailure,
  readCurrentVersion,
  type UpdateFailureStatus,
  type UpdateStatus,
} from '@/service/updates'

/** Human release page for the manual install path; no update source is faked. */
const RELEASE_PAGE = 'https://github.com/baicie/terminal/releases'

const FAILURE_COPY: Record<UpdateFailureStatus, { title: string; hint: string }> =
  {
    offline: {
      title: 'This device is offline.',
      hint: 'No update check can reach the release server without a network connection. Reconnect and check again.',
    },
    timeout: {
      title: 'The release server did not answer in time.',
      hint: 'The request timed out. The endpoint may be slow or blocked; try again in a moment.',
    },
    unreachable: {
      title: 'The release server is unreachable.',
      hint: 'The endpoint answered with an error or without a usable release manifest. Nothing was downloaded.',
    },
    unconfigured: {
      title: 'Update checks are not configured in this build.',
      hint: 'Either no update endpoint is enabled or the updater public key is still a placeholder, so this build refuses to trust a manifest.',
    },
    signature: {
      title: 'The update failed signature verification and was rejected.',
      hint: 'The manifest or package did not match the trusted key. The updater fails closed and installs nothing.',
    },
  }

function CurrentVersion({
  resolved,
  version,
}: {
  resolved: boolean
  version: string | null
}) {
  if (!resolved)
    return (
      <p className="text-xs text-muted-foreground">Current version: reading…</p>
    )
  return (
    <p className="text-xs text-muted-foreground">
      Current version:{' '}
      <span className="font-mono" data-current-version={version ?? ''}>
        {version ?? 'not reported by this runtime'}
      </span>
    </p>
  )
}

function StatusBody({ status }: { status: UpdateStatus }) {
  if (isUpdateFailure(status)) {
    const copy = FAILURE_COPY[status.status]
    return (
      <>
        <p className="font-medium text-destructive">{copy.title}</p>
        <p className="text-muted-foreground">{copy.hint}</p>
        <p className="font-mono text-[11px] break-all text-muted-foreground">
          {status.detail}
        </p>
      </>
    )
  }
  if (status.status === 'unsupported')
    return (
      <>
        <p className="font-medium">Update checks need the desktop app.</p>
        <p className="text-muted-foreground">
          This window runs without the updater plugin.
        </p>
      </>
    )
  if (status.status === 'up-to-date')
    return (
      <p className="font-medium">
        {status.version
          ? `You are on the latest version (${status.version}).`
          : 'You are on the latest version.'}
      </p>
    )
  if (status.status === 'available')
    return (
      <>
        <p className="font-medium">
          Version {status.version} is available.
        </p>
        {status.notes ? (
          <p className="text-muted-foreground">{status.notes}</p>
        ) : null}
        <p className="text-muted-foreground">
          Installing from this screen stays blocked on purpose: the updater
          public key compiled into this build is a placeholder, so a downloaded
          package could not be verified and the install path would reject it.
          Download the release and install it over this build.
        </p>
        <p className="font-mono text-[11px] break-all text-muted-foreground">
          {RELEASE_PAGE}
        </p>
      </>
    )
  return (
    <>
      <p className="font-medium text-destructive">The update check failed.</p>
      <p className="font-mono text-[11px] break-all text-muted-foreground">
        {status.detail}
      </p>
    </>
  )
}

const UpdateCheck: React.FC = () => {
  const [status, setStatus] = useState<UpdateStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [version, setVersion] = useState<string | null>(null)
  const [versionResolved, setVersionResolved] = useState(false)

  useEffect(() => {
    let active = true
    void readCurrentVersion().then(resolved => {
      if (!active) return
      setVersion(resolved)
      setVersionResolved(true)
    })
    return () => {
      active = false
    }
  }, [])

  const run = async () => {
    setChecking(true)
    try {
      const next = await checkForUpdates()
      setStatus(next)
      if ('version' in next && next.version) {
        setVersion(next.version)
        setVersionResolved(true)
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="space-y-3">
      <Separator />
      <div className="space-y-2">
        <p className="text-sm font-medium">Updates</p>
        <CurrentVersion resolved={versionResolved} version={version} />
        <p className="text-xs text-muted-foreground">
          This build ships without Apple or Windows code signing. A check only
          reads the release manifest; the install path verifies the updater
          signature and fails closed while the public key is still a
          placeholder.
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
          <div
            className="space-y-1 text-xs"
            data-status={status.status}
            role="status"
          >
            <StatusBody status={status} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

export { UpdateCheck }
