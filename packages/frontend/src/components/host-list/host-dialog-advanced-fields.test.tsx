import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { HostFormState } from './host-dialog-advanced-fields'
import { HostDialogAdvancedFields } from './host-dialog-advanced-fields'

const form: HostFormState = {
  name: 'Host',
  hostname: 'host.example',
  port: 22,
  username: 'user',
  authType: 'password',
  isFavorite: false,
  portForwards: [],
  agentForwarding: false,
  shellIntegration: 'off',
}

it('allows SSH agent forwarding to be enabled independently of login authentication', () => {
  const onChange = vi.fn()
  render(
    <HostDialogAdvancedFields
      form={form}
      onChange={onChange}
      onOpenEnvironment={vi.fn()}
      onOpenPortForwards={vi.fn()}
    />,
  )

  fireEvent.click(screen.getByRole('switch', { name: 'Forward SSH agent' }))

  expect(onChange).toHaveBeenCalledWith({
    ...form,
    agentForwarding: true,
  })
})

it('keeps remote shell integration disabled until a shell is selected', () => {
  const onChange = vi.fn()
  render(
    <HostDialogAdvancedFields
      form={form}
      onChange={onChange}
      onOpenEnvironment={vi.fn()}
      onOpenPortForwards={vi.fn()}
    />,
  )

  expect(
    screen.getByRole('combobox', { name: 'Remote Shell Integration' }),
  ).toBeTruthy()
  expect(screen.queryByRole('option', { name: 'Bash' })).toBeNull()
})

it('persists an explicit bash shell integration choice', () => {
  const onChange = vi.fn()
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn(),
  })
  render(
    <HostDialogAdvancedFields
      form={form}
      onChange={onChange}
      onOpenEnvironment={vi.fn()}
      onOpenPortForwards={vi.fn()}
    />,
  )

  fireEvent.click(
    screen.getByRole('combobox', { name: 'Remote Shell Integration' }),
  )
  fireEvent.click(screen.getByRole('option', { name: 'Bash' }))

  expect(onChange).toHaveBeenCalledWith({ ...form, shellIntegration: 'bash' })
})
