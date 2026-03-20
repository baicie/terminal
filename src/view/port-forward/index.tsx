import { ViewContainer, ViewToolbar, ViewContent, ViewHeader, EmptyState } from "@/components/view-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeftRight, Plus } from "lucide-react";

const PortForwardView: React.FC = () => {
  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <Input placeholder="Search forwards..." className="max-w-xs h-9" />
        <div className="flex-1" />
        <Button size="sm">
          <Plus className="size-4 mr-1" data-icon="inline-start" />
          New Forward
        </Button>
      </ViewToolbar>

      <ViewContent className="p-6">
        <ViewHeader
          title="Port Forwarding"
          description="Manage SSH tunnels and port forwarding rules"
        />

        <EmptyState
          icon={<ArrowLeftRight className="size-12" />}
          title="No port forwards configured"
          description="Set up port forwarding to access databases, web apps, and other services"
          action={
            <Button>
              <Plus className="size-4 mr-1" data-icon="inline-start" />
              Add Forward
            </Button>
          }
        />
      </ViewContent>
    </ViewContainer>
  );
};

export default PortForwardView;
