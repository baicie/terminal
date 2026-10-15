import type { WorkspaceLayout } from '@/types'

const WORKSPACE_RECOVERY_JOURNAL_VERSION = 1
const WORKSPACE_RECOVERY_JOURNAL_PREFIX = 'terminal.workspace.recovery.v1.'

export interface PendingWorkspaceSnapshot {
  workspaceId: string
  layout: WorkspaceLayout
  journalValue: string
}

interface WorkspaceRecoveryJournal {
  version: 1
  savedAt: number
  layout: WorkspaceLayout
}

type SanitizeWorkspaceRecoveryLayout = (
  layout: WorkspaceLayout,
  workspaceId?: string,
) => WorkspaceLayout

export function getWorkspaceRecoveryJournalKey(workspaceId: string): string {
  return `${WORKSPACE_RECOVERY_JOURNAL_PREFIX}${workspaceId}`
}

export function createRecoveryJournal(
  workspaceId: string,
  layout: WorkspaceLayout,
  sanitizeLayout: SanitizeWorkspaceRecoveryLayout,
): PendingWorkspaceSnapshot {
  const sanitized = sanitizeLayout(layout, workspaceId)
  const journal: WorkspaceRecoveryJournal = {
    version: WORKSPACE_RECOVERY_JOURNAL_VERSION,
    savedAt: Date.now(),
    layout: sanitized,
  }
  return {
    workspaceId,
    layout: sanitized,
    journalValue: JSON.stringify(journal),
  }
}

export function writeRecoveryJournal(snapshot: PendingWorkspaceSnapshot): void {
  try {
    localStorage.setItem(
      getWorkspaceRecoveryJournalKey(snapshot.workspaceId),
      snapshot.journalValue,
    )
  } catch (error) {
    console.warn('Failed to journal terminal workspace recovery state:', error)
  }
}

export function readRecoveryJournal(
  workspaceId: string,
  sanitizeLayout: SanitizeWorkspaceRecoveryLayout,
): PendingWorkspaceSnapshot | null {
  const key = getWorkspaceRecoveryJournalKey(workspaceId)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<WorkspaceRecoveryJournal>
    if (
      parsed.version !== WORKSPACE_RECOVERY_JOURNAL_VERSION ||
      !parsed.layout ||
      typeof parsed.layout !== 'object'
    ) {
      localStorage.removeItem(key)
      return null
    }
    const snapshot = createRecoveryJournal(
      workspaceId,
      parsed.layout,
      sanitizeLayout,
    )
    writeRecoveryJournal(snapshot)
    return snapshot
  } catch (error) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Storage may be unavailable; SQLite recovery still remains usable.
    }
    console.warn(
      'Ignored an invalid terminal workspace recovery journal:',
      error,
    )
    return null
  }
}

export function removeRecoveryJournal(
  snapshot: PendingWorkspaceSnapshot,
): void {
  const key = getWorkspaceRecoveryJournalKey(snapshot.workspaceId)
  try {
    if (localStorage.getItem(key) === snapshot.journalValue) {
      localStorage.removeItem(key)
    }
  } catch {
    // The sanitized journal is safe to retry on the next launch.
  }
}
