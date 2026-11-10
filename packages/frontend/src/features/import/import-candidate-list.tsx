/**
 * The OpenSSH import wizard's preview step.
 *
 * Shows exactly what would be written before anything is written: which entries
 * are new, which duplicate something already saved, which cannot be imported at
 * all, and which carried warnings. Nothing here writes; the confirm button in the
 * parent does that once the user has seen this.
 */

import { AlertTriangle, CheckCircle2, CircleSlash, Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ImportCandidate } from '@/features/import/import-plan'

interface ImportCandidateListProps {
  candidates: ImportCandidate[]
  selected: ReadonlySet<string>
  onToggle: (id: string) => void
  onToggleAll: (selected: boolean) => void
}

/**
 * One row per parsed entry.
 *
 * A duplicate or invalid entry has its checkbox disabled rather than hidden: the
 * user needs to see that their config contains something, even when the import
 * will not create it. Hiding it would make "my host is missing" look like a bug.
 */
export function ImportCandidateList({
  candidates,
  selected,
  onToggle,
  onToggleAll,
}: ImportCandidateListProps) {
  const { t } = useTranslation()
  const selectable = candidates.filter(c => c.decision === 'create')
  const allSelected =
    selectable.length > 0 && selectable.every(c => selected.has(c.id))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Checkbox
            id="import-select-all"
            checked={allSelected}
            disabled={selectable.length === 0}
            onCheckedChange={checked => onToggleAll(checked === true)}
          />
          <Label htmlFor="import-select-all" className="text-sm">
            {t('hosts.import.selectAll', { count: selectable.length })}
          </Label>
        </div>
      </div>

      <ul className="divide-y divide-border/60 rounded-lg border border-border/60">
        {candidates.map(candidate => (
          <ImportCandidateRow
            key={candidate.id}
            candidate={candidate}
            checked={selected.has(candidate.id)}
            onToggle={() => onToggle(candidate.id)}
          />
        ))}
      </ul>
    </div>
  )
}

function ImportCandidateRow({
  candidate,
  checked,
  onToggle,
}: {
  candidate: ImportCandidate
  checked: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()
  const selectable = candidate.decision === 'create'

  return (
    <li
      className={cn(
        'flex items-start gap-3 p-3',
        !selectable && 'opacity-70',
      )}
      data-testid={`import-row-${candidate.name}`}
    >
      <Checkbox
        id={`import-${candidate.id}`}
        checked={checked}
        disabled={!selectable}
        onCheckedChange={onToggle}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={`import-${candidate.id}`} className="text-sm font-medium">
            {candidate.name}
          </Label>
          {candidate.decision === 'create' && (
            <Badge variant="secondary" className="gap-1">
              <CheckCircle2 className="size-3" />
              {t('hosts.import.willCreate')}
            </Badge>
          )}
          {candidate.decision === 'duplicate' && (
            <Badge variant="outline" className="gap-1">
              <Copy className="size-3" />
              {t('hosts.import.duplicate')}
            </Badge>
          )}
          {candidate.decision === 'invalid' && (
            <Badge variant="destructive" className="gap-1">
              <CircleSlash className="size-3" />
              {t('hosts.import.cannotImport')}
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {candidate.username}@{candidate.hostname}:{candidate.port}
        </p>
        {candidate.reason && (
          <p className="text-xs text-muted-foreground">{candidate.reason}</p>
        )}
        {candidate.identityFile !== null && (
          <p className="text-xs text-muted-foreground">
            {t('hosts.import.keyFile', { path: candidate.identityFile })}
          </p>
        )}
      </div>
    </li>
  )
}

/** The warnings the parser produced, shown above the list. */
export function ImportWarningList({
  warnings,
}: {
  warnings: Array<{ line: number, message: string }>
}) {
  const { t } = useTranslation()
  if (warnings.length === 0) return null

  return (
    <div className="space-y-1 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <AlertTriangle className="size-4 text-warning" />
        {t('hosts.import.warnings', { count: warnings.length })}
      </p>
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {warnings.map((warning, index) => (
          <li key={`${warning.line}-${index}`}>
            {warning.line > 0 ? `L${warning.line}: ` : ''}
            {warning.message}
          </li>
        ))}
      </ul>
    </div>
  )
}
