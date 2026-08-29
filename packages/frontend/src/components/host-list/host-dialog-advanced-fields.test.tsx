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
