import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en/teams'
import { CreateTeamDialog } from './create-team-dialog'

const mocks = vi.hoisted(() => ({
  createTeam: vi.fn(),
  createCloudTeamWithSettings: vi.fn(),
  enableTeamMode: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('sonner', () => ({ toast: mocks.toast }))

vi.mock('@/store/team', () => ({
  useTeamStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      createTeam: mocks.createTeam,
      createCloudTeamWithSettings: mocks.createCloudTeamWithSettings,
      enableTeamMode: mocks.enableTeamMode,
    }),
}))

beforeEach(() => {
  vi.clearAllMocks()
})

function fillCloudForm() {
  fireEvent.change(screen.getByLabelText(en['teams.teamName']), {
    target: { value: 'Team' },
  })
  fireEvent.click(screen.getByText(en['teams.cloudMode']))
  fireEvent.change(screen.getByLabelText(en['teams.serverEndpoint']), {
    target: { value: 'https://team.example.com' },
  })
  fireEvent.change(screen.getByLabelText(en['teams.apiToken']), {
    target: { value: 'token' },
  })
}

describe('cloud team creation feedback', () => {
  it('does not report success when the server create fails', async () => {
    mocks.createCloudTeamWithSettings.mockResolvedValue({
      ok: false,
      team: null,
      stage: 'create',
      error: '401 Unauthorized',
    })
    render(<CreateTeamDialog open onOpenChange={vi.fn()} />)
    fillCloudForm()
    fireEvent.click(screen.getByRole('button', { name: en['teams.createTeam'] }))

    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalled())
    expect(mocks.toast.success).not.toHaveBeenCalled()
    expect(mocks.createTeam).not.toHaveBeenCalled()
  })

  it('reports success only after the server action succeeds', async () => {
    mocks.createCloudTeamWithSettings.mockResolvedValue({
      ok: true,
      team: { id: 'srv-1' },
    })
    render(<CreateTeamDialog open onOpenChange={vi.fn()} />)
    fillCloudForm()
    fireEvent.click(screen.getByRole('button', { name: en['teams.createTeam'] }))

    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled())
    expect(mocks.toast.error).not.toHaveBeenCalled()
    expect(mocks.createCloudTeamWithSettings).toHaveBeenCalledWith(
      'Team',
      'https://team.example.com',
      'token',
    )
  })
})
