import { observer } from "mobx-react-lite";
import VaultsView from "./vaults-view";

const VaultsContainer: React.FC = observer(() => {
  return <VaultsView />;
});

export default VaultsContainer;
