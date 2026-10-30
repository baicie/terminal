import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Host } from '@/types'
import i18n from '@/locales'
import cn from '@/locales/cn'
import fr from '@/locales/fr'

vi.mock('@/components/ui/sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}))

vi.mock('@/service/database', () => ({
  getAppSettings: vi.fn(async () => ({ language: 'en', theme: 'light' })),
  saveAppSettings: vi.fn(async () => undefined),
}))

vi.mock('@/service/notifications', () => ({
  applyNotificationPrefs: vi.fn(),
  resetNotificationPermissionCache: vi.fn(),
}))

vi.mock('@/service/window-ux', () => ({
  syncCloseToTray: vi.fn(),
}))

vi.mock('@/store/app', () => ({
  useAppStore: () => ({ setLanguage: vi.fn(), setTheme: vi.fn() }),
}))

vi.mock('@/service/team-host-data', () => ({
  createShareableTeamHostData: (host: Host) => ({ ...host }),
}))

vi.mock('@/utils/team-encryption', () => ({
  encryptWithPassword: vi.fn(),
  validatePasswordStrength: () => ({ message: '', valid: true }),
}))

vi.mock('./settings-dialog/general-settings', () => ({
  GeneralSettings: () => null,
}))
vi.mock('./settings-dialog/storage-settings-dialog', () => ({
  StorageSettingsDialog: () => null,
}))
vi.mock('./settings-dialog/team-settings-dialog', () => ({
  TeamSettingsDialog: () => null,
}))
vi.mock('./settings-dialog/export-import-settings', () => ({
  ExportImportSettings: () => null,
}))
vi.mock('./settings-dialog/terminal-settings', () => ({
  TerminalSettings: () => null,
}))
vi.mock('./settings-dialog/shortcuts-settings', () => ({
  ShortcutsSettings: () => null,
}))
vi.mock('./settings-dialog/update-check', () => ({
  UpdateCheck: () => null,
}))

import SettingsDialog from './settings-dialog'
import { ShareHostDialog } from './share-host-dialog'

const host = {
  hostname: 'build.example.test',
  id: 'host-1',
  name: 'build-server',
  password: 'secret',
  port: 22,
  username: 'deploy',
} as unknown as Host

function clickSwitch(id: string) {
  const element = document.getElementById(id)
  if (!element) throw new Error(`switch ${id} is not rendered`)
  fireEvent.click(element)
}

describe('ShareHostDialog security copy', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('fr')
  })

  it('renders every security notice from the active locale', () => {
    render(
      <ShareHostDialog
        host={host}
        onOpenChange={vi.fn()}
        onShare={vi.fn(async () => undefined)}
        open
      />,
    )

    expect(screen.getByText(fr['teams.includePasswordDesc'])).toBeTruthy()

    clickSwitch('include-password')
    expect(screen.getByText(fr['teams.encryptPasswordDesc'])).toBeTruthy()
    expect(
      screen.getByText(fr['teams.plaintextPasswordWarning']),
    ).toBeTruthy()
    expect(screen.queryByText(/密码将以明文形式共享/)).toBeNull()

    clickSwitch('encrypt-password')
    expect(screen.getByText(fr['teams.encryptionHint'])).toBeTruthy()
    expect(screen.queryByText(/团队成员需要输入密码/)).toBeNull()
  })
})

describe('SettingsDialog copy', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('cn')
  })

  it('renders the dialog chrome from the active locale', async () => {
    render(<SettingsDialog onClose={vi.fn()} open />)

    expect(await screen.findByText(cn['settings.appearance'])).toBeTruthy()
    expect(screen.getByText(cn['settings.title'])).toBeTruthy()
    expect(screen.getByText(cn['settings.shortcutsTab'])).toBeTruthy()
    expect(screen.getByText(cn['settings.team'])).toBeTruthy()
    expect(screen.getByText(cn['settings.theme'])).toBeTruthy()
    expect(screen.getByText(cn['common.save'])).toBeTruthy()
    expect(screen.getByText(cn['common.cancel'])).toBeTruthy()
    expect(screen.queryByText('Appearance')).toBeNull()
    expect(screen.queryByText('Save')).toBeNull()
    expect(screen.queryByText('Cancel')).toBeNull()
  })
})
