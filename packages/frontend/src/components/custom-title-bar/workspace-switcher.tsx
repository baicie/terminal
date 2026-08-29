import WorkspaceSwitcher from '@/components/workspace-switcher'

export function TitleBarWorkspaceSwitcher({
  onSettingsClick,
}: {
  onSettingsClick?: () => void
}) {
  return <WorkspaceSwitcher onSettingsClick={onSettingsClick} />
}
