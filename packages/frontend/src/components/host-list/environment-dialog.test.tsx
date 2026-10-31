import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { EnvironmentVariablesDialog } from './environment-dialog'

const keyInputs = () =>
  Array.from(document.querySelectorAll<HTMLInputElement>('input[placeholder="KEY"]'))

function removeRow(index: number) {
  const row = keyInputs()[index]?.parentElement
  const button = row?.querySelector('button')
  if (!button) throw new Error(`remove button for row ${index} not found`)
  fireEvent.click(button)
}

describe('EnvironmentVariablesDialog row identity', () => {
  it('keeps the DOM node of a surviving row when an earlier row is removed', () => {
    render(
      <EnvironmentVariablesDialog
        envVars={[
          { key: 'A', value: '1' },
          { key: 'B', value: '2' },
          { key: 'C', value: '3' },
        ]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        open
      />,
    )

    const before = keyInputs()
    expect(before.map(input => input.value)).toEqual(['A', 'B', 'C'])

    removeRow(0)

    const after = keyInputs()
    expect(after.map(input => input.value)).toEqual(['B', 'C'])
    // Index keys would have reused row A's node for B and B's node for C.
    expect(after[0]).toBe(before[1])
    expect(after[1]).toBe(before[2])
  })

  it('saves rows without leaking the internal row ids', () => {
    const onSave = vi.fn()
    render(
      <EnvironmentVariablesDialog
        envVars={[
          { key: 'A', value: '1' },
          { key: 'B', value: '2' },
        ]}
        onClose={vi.fn()}
        onSave={onSave}
        open
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledWith([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ])
  })
})
