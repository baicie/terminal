import { ViewContainer, ViewToolbar, ViewContent, ViewHeader } from "@/components/view-container";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

const LogsView: React.FC = () => {
  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <Button size="sm" variant="outline">
          <Download className="size-4 mr-1" data-icon="inline-start" />
          Export
        </Button>
      </ViewToolbar>
      <ViewContent className="p-6">
        <ViewHeader
          title="Logs"
          description="View connection and session logs"
        />
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Logs view coming soon...
        </div>
      </ViewContent>
    </ViewContainer>
  );
};

export default LogsView;
