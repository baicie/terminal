import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { toast } from '@/components/ui/sonner'
import {
  previewCredentialMigration,
  migratePlaintextCredentials,
} from '@/service/credential-migration-run'
import type { MigrationPlan } from '@/service/credential-migration'
import type { MigrationRunResult } from '@/service/credential-migration-run'

/**
 * Migrate pre-Phase-10 plaintext credentials into the vault.
 *
 * Three deliberate properties, because this is the one operation that clears
 * plaintext columns:
 *
 *  - **Nothing happens on mount.** The component asks for a *preview*, which reads
 *    counts and row names and writes nothing.
 *  - **Nothing happens without a click on the confirm button**, and that button is
 *    not the default action.
 *  - **The result is shown, not announced as success.** "Migrated 3, failed 1,
 *    verification passed" is the only honest summary; a bare toast would let a
 *    partial run look complete.
 *
 * The panel also states the limit it cannot fix: clearing a column does not rewrite
 * pages an old WAL or an existing backup file still holds.
 */
export function CredentialMigrationPanel() {
  const { t } = useTranslation()
  const [plan, setPlan] = useState<MigrationPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<MigrationRunResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadPlan = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPlan(await previewCredentialMigration())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPlan()
  }, [loadPlan])

  const run = useCallback(async () => {
    setRunning(true)
    setError(null)
    try {
      const outcome = await migratePlaintextCredentials({ authorized: true })
      setResult(outcome)
      setPlan(outcome.plan)
      if (outcome.aborted) {
        toast.error(t('settings.migrationVaultUnavailable'))
      } else if (outcome.failed.length > 0) {
        toast.warning(
          t('settings.migrationPartial', { failed: outcome.failed.length }),
        )
      } else {
        toast.success(t('settings.migrationSucceeded'))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(false)
    }
  }, [t])

  const nothingToDo =
    plan !== null && plan.hosts.length === 0 && plan.keys.length === 0

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <ShieldAlert className="size-4" />
        <h4 className="text-sm font-medium">{t('settings.migrationTitle')}</h4>
      </div>
      <p className="text-sm text-muted-foreground">
        {t('settings.migrationDesc')}
      </p>

      {loading && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="size-3 animate-spin" />
          {t('settings.migrationChecking')}
        </p>
      )}

      {!loading && error && (
        <div className="p-3 rounded-lg bg-destructive/10 flex items-start gap-2">
          <AlertTriangle className="size-4 text-destructive shrink-0 mt-0.5" />
          <div className="space-y-2">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" size="sm" onClick={loadPlan}>
              {t('settings.tryAgain')}
            </Button>
          </div>
        </div>
      )}

      {!loading && !error && plan && (
        <>
          <p className="text-sm" data-testid="migration-summary">
            {plan.summary}
          </p>

          {plan.hosts.length > 0 || plan.keys.length > 0 ? (
            <ul className="max-h-40 overflow-y-auto space-y-1 text-xs text-muted-foreground">
              {plan.hosts.map(host => (
                <li key={`host:${host.id}`} className="truncate">
                  {host.name} — {host.kinds.join(', ')}
                </li>
              ))}
              {plan.keys.map(key => (
                <li key={`key:${key.id}`} className="truncate">
                  {key.name} — {key.kinds.join(', ')}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="p-3 rounded-lg bg-muted/50 flex items-start gap-2">
            <AlertTriangle className="size-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground">
              {t('settings.migrationWarning')}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={run}
            disabled={running || nothingToDo}
          >
            {running ? (
              <Loader2 className="size-3 animate-spin" data-icon="inline-start" />
            ) : null}
            {t('settings.migrationRun')}
          </Button>
        </>
      )}

      {result && (
        <>
          <Separator />
          <div className="space-y-2 text-sm" data-testid="migration-result">
            <p className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-green-600" />
              {t('settings.migrationCounts', {
                hosts: result.migratedHosts,
                keys: result.migratedKeys,
                failed: result.failed.length,
              })}
            </p>
            {result.snapshotPath && (
              <p className="text-xs text-muted-foreground break-all">
                {t('settings.migrationSnapshot', { path: result.snapshotPath })}
              </p>
            )}
            {result.aborted && (
              <p className="text-xs text-destructive">
                {t('settings.migrationVaultUnavailable')}
              </p>
            )}
            {result.verification && (
              <p className="text-xs text-muted-foreground">
                {result.verification.ok
                  ? t('settings.migrationVerified')
                  : t('settings.migrationVerifyFailed', {
                      count:
                        result.verification.remainingPlaintext.length +
                        result.verification.unreadableReferences.length,
                    })}
              </p>
            )}
            {result.failed.length > 0 && (
              <ul className="max-h-32 overflow-y-auto space-y-1 text-xs text-muted-foreground">
                {result.failed.map(failure => (
                  <li key={`${failure.kind}:${failure.id}`} className="truncate">
                    {failure.name}: {failure.reason}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  )
}
