import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/locales'
import type { ScriptRecord } from '@/service/database'
import { ScriptList } from './script-list'

const baseScript: ScriptRecord = {
  created_at: 0,
  description: null,
  enabled: 1,
  host_ids: '[]',
  id: 'script-1',
  name: 'Deploy',
  retry_count: 0,
  schedule_type: 'manual',
  schedule_value: null,
  script: 'echo hello',
  timeout_seconds: 60,
  updated_at: 0,
}

function renderList(hostIds: string) {
  render(
    <ScriptList
      isExecuting={false}
      isLoading={false}
      onDelete={vi.fn()}
      onEdit={vi.fn()}
      onExecute={vi.fn()}
      onToggleEnabled={vi.fn()}
      scripts={[{ ...baseScript, host_ids: hostIds }]}
    />,
  )
}

describe('ScriptList host id parsing', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('still counts hosts from a well-formed host_ids array', () => {
    renderList('["host-1","host-2"]')

    expect(screen.getByText('2 hosts')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement)
        .disabled,
    ).toBe(false)
  })

  it('renders zero hosts and keeps Run disabled for malformed host_ids', () => {
    renderList('["host-1"')

    expect(screen.getByText('0 hosts')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Run' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })
})
