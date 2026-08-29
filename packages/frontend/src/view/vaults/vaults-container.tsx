import { ViewContainer, ViewContent } from '@/components/view-container'
import { useVaultsContainer } from './use-vaults-container'
import { VaultsContainerCreate } from './vaults-container-create'
import { VaultsContainerLocked } from './vaults-container-locked'
import { VaultsContainerUnlocked } from './vaults-container-unlocked'

const VaultsContainer: React.FC = () => {
  const vault = useVaultsContainer()

  if (vault.loading) {
    return (
      <ViewContainer>
        <ViewContent className="p-6">
          <div className="flex items-center justify-center h-full">
            <div className="text-muted-foreground">Loading vault...</div>
          </div>
        </ViewContent>
      </ViewContainer>
    )
  }
  if (vault.vaultExists === false) {
    return <VaultsContainerCreate vault={vault} />
  }
  if (!vault.isUnlocked) {
    return <VaultsContainerLocked vault={vault} />
  }
  return <VaultsContainerUnlocked vault={vault} />
}

export default VaultsContainer
