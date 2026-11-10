/**
 * The wizard's state machine, separated from its markup.
 *
 * The dialog is mostly a rendering of five states — idle, error, previewing,
 * importing, done — and keeping that here means the component stays small enough
 * to read and the transitions are testable without rendering anything.
 *
 * The invariant this module owns: nothing is written until `runImport` is called,
 * and a duplicate is never selected by default. Both are asserted by the tests
 * that drive the dialog, so they cannot drift into the UI by accident.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/components/ui/sonner'
import { materialiseImport } from '@/features/import/import-plan'
import { planOpenSshImport } from '@/features/import/import-source'
import type { OpenSshImportSource } from '@/features/import/import-source'
import { readSshConfigFile } from '@/features/import/ssh-config-file'
import { useHostStore } from '@/store/host'

export interface ImportOutcome {
  created: string[]
  failed: Array<{ name: string, message: string }>
}

export function useOpenSshImport() {
  const { t } = useTranslation()
  const hosts = useHostStore(s => s.hosts)
  const addHost = useHostStore(s => s.addHost)

  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasted, setPasted] = useState('')
  const [source, setSource] = useState<OpenSshImportSource | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)

  const reset = () => {
    setPasteOpen(false)
    setPasted('')
    setSource(null)
    setSelected(new Set())
    setError(null)
    setBusy(false)
    setOutcome(null)
  }

  const plan = (text: string, path: string) => {
    setError(null)
    setOutcome(null)
    const result = planOpenSshImport(text, { path, existingHosts: hosts })
    if (!result.ok) {
      setError(result.message)
      setSource(null)
      return
    }
    setSource(result.source)
    // Only what can actually be created starts checked. A duplicate is never
    // preselected — that is what "the default does not overwrite" means.
    setSelected(
      new Set(
        result.source.plan.candidates
          .filter(candidate => candidate.decision === 'create')
          .map(candidate => candidate.id),
      ),
    )
  }

  const pickFile = async () => {
    setBusy(true)
    setError(null)
    try {
      const { open: openDialog } = await import('@tauri-apps/plugin-dialog')
      const picked = await openDialog({
        multiple: false,
        filters: [
          { name: 'SSH config', extensions: ['config', 'conf', 'txt'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
      if (typeof picked !== 'string') return
      const read = await readSshConfigFile(picked)
      if (!read.ok) {
        setError(read.message)
        return
      }
      plan(read.content, picked)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) => {
    setSelected(previous => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = (checked: boolean) => {
    if (!source) return
    setSelected(
      checked
        ? new Set(
            source.plan.candidates
              .filter(candidate => candidate.decision === 'create')
              .map(candidate => candidate.id),
          )
        : new Set(),
    )
  }

  const runImport = async () => {
    if (!source) return
    setBusy(true)
    const created: string[] = []
    const failed: ImportOutcome['failed'] = []
    try {
      const rows = materialiseImport(source.plan.candidates, selected)
      for (const row of rows) {
        try {
          await addHost(row)
          created.push(row.name)
        } catch (cause) {
          // Per entry, not per batch: one host whose vault write fails must not
          // hide the nine that succeeded, and must be named so the user knows
          // which one to retry.
          failed.push({
            name: row.name,
            message: cause instanceof Error ? cause.message : String(cause),
          })
        }
      }
      setOutcome({ created, failed })
      if (created.length > 0) {
        toast.success(t('hosts.import.created', { count: created.length }))
      }
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    error,
    outcome,
    pasteOpen,
    pasted,
    pickFile,
    plan,
    reset,
    runImport,
    selected,
    setPasteOpen,
    setPasted,
    source,
    toggle,
    toggleAll,
  }
}
