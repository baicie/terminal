import { Check, Users } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { TeamServerConfig } from './team-server-config'
import { useIsTeamEnabled } from '@/store/team'

interface TeamSettingsDialogProps {
  onClose: () => void
}

export function TeamSettingsDialog({ onClose }: TeamSettingsDialogProps) {
  const navigate = useNavigate()
  const isTeamEnabled = useIsTeamEnabled()

  return (
    <div className="space-y-6 py-4">
      <div className="space-y-3">
        <h4 className="text-sm font-medium flex items-center gap-2">
          <Users className="h-4 w-4" />
          Team Collaboration
        </h4>
        <p className="text-sm text-muted-foreground">
          Enable team features to share hosts and snippets with your team
          members. Use local mode to export/import team packages as JSON files.
        </p>

        {isTeamEnabled ? (
          <div className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <Check className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Team mode enabled</span>
            </div>
            <p className="text-xs text-muted-foreground ml-6">
              Teams navigation is visible in the sidebar. Manage your teams from
              the Teams view.
            </p>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 ml-6"
              onClick={() => {
                onClose()
                navigate('/teams')
              }}
            >
              <Users className="h-3 w-3 mr-1" />
              Open Teams View
            </Button>
          </div>
        ) : (
          <div className="p-3 bg-muted rounded-lg">
            <div className="flex items-center gap-2 mb-1">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Team mode disabled</span>
            </div>
            <p className="text-xs text-muted-foreground ml-6">
              Enable team mode to collaborate with team members.
            </p>
            <Button
              size="sm"
              className="mt-3 ml-6"
              onClick={() => {
                onClose()
                navigate('/teams')
              }}
            >
              <Users className="h-3 w-3 mr-1" />
              Enable Team Mode
            </Button>
          </div>
        )}
      </div>

      <Separator />

      <TeamServerConfig onClose={onClose} />

      <Separator />
    </div>
  )
}
