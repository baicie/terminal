import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { HostFormActions } from './host-form-actions'

it('allows a new host form to submit while it is not saving', () => {
  render(
    <HostFormActions
      saving={false}
      deleteDialogOpen={false}
      onClose={vi.fn()}
      onDelete={vi.fn()}
      onDeleteDialogOpenChange={vi.fn()}
      onSubmit={vi.fn()}
    />,
  )

  expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)
})
