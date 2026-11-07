import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

const FAILURE_COPY: Record<
  UpdateFailureStatus,
  { titleKey: string, hintKey: string }
> = {
  offline: {
    titleKey: 'settings.updateOffline',
    hintKey: 'settings.updateOfflineHint',
  },
  timeout: {
    titleKey: 'settings.updateTimeout',
    hintKey: 'settings.updateTimeoutHint',
  },
  unreachable: {
    titleKey: 'settings.updateUnreachable',
    hintKey: 'settings.updateUnreachableHint',
  },
  unconfigured: {
    titleKey: 'settings.updateUnconfigured',
    hintKey: 'settings.updateUnconfiguredHint',
  },
  signature: {
    titleKey: 'settings.updateSignature',
    hintKey: 'settings.updateSignatureHint',
  },
}

function CurrentVersion({
  resolved,
  version,
}: {
  resolved: boolean
  version: string | null
}) {
  const { t } = useTranslation()
  if (!resolved)
    return (
      <p className="text-xs text-muted-foreground">
        {t('settings.currentVersionReading')}
      </p>
    )
  return (
    <p className="text-xs text-muted-foreground">
      {t('settings.currentVersion')}{' '}
      <span className="font-mono" data-current-version={version ?? ''}>
        {version ?? t('settings.versionNotReported')}
      </span>
    </p>
  )
}

function StatusBody({ status }: { status: UpdateStatus }) {
  const { t } = useTranslation()
  if (isUpdateFailure(status)) {
    const copy = FAILURE_COPY[status.status]
    return (
      <>
        <p className="font-medium text-destructive">{t(copy.titleKey)}</p>
        <p className="text-muted-foreground">{t(copy.hintKey)}</p>
        <p className="font-mono text-[11px] break-all text-muted-foreground">
          {status.detail}
        </p>
      </>
    )
  }
  if (status.status === 'unsupported')
    return (
      <>
        <p className="font-medium">{t('settings.updateDesktopOnly')}</p>
        <p className="text-muted-foreground">
          {t('settings.updateDesktopOnlyHint')}
        </p>
      </>
    )
  if (status.status === 'up-to-date')
    return (
      <p className="font-medium">
        {status.version
          ? t('settings.updateLatestVersion', { version: status.version })
          : t('settings.updateLatest')}
      </p>
    )
  if (status.status === 'available')
    return (
      <>
        <p className="font-medium">
          {t('settings.updateAvailable', { version: status.version })}
        </p>
        {status.notes ? (
          <p className="text-muted-foreground">{status.notes}</p>
        ) : null}
        <p className="text-muted-foreground">
          {t('settings.updateInstallBlocked')}
        </p>
        <p className="font-mono text-[11px] break-all text-muted-foreground">
          {RELEASE_PAGE}
        </p>
      </>
    )
  return (
    <>
      <p className="font-medium text-destructive">{t('settings.updateFailed')}</p>
      <p className="font-mono text-[11px] break-all text-muted-foreground">
        {status.detail}
      </p>
    </>
  )
}

const UpdateCheck: React.FC = () => {
  const { t } = useTranslation()
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
        <p className="text-sm font-medium">{t('settings.updates')}</p>
        <CurrentVersion resolved={versionResolved} version={version} />
        <p className="text-xs text-muted-foreground">
          {t('settings.updateNoSigning')}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={run}
          disabled={checking}
        >
          {checking ? t('settings.checking') : t('settings.checkForUpdates')}
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
