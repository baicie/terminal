import { ViewContainer, ViewToolbar, ViewContent, ViewHeader, EmptyState } from "@/components/view-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Fingerprint, Upload } from "lucide-react";

const KnownHostsView: React.FC = () => {
  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <Input placeholder="Search known hosts..." className="max-w-xs h-9" />
        <div className="flex-1" />
        <Button variant="outline" size="sm">
          <Upload className="size-4 mr-1" data-icon="inline-start" />
          Import
        </Button>
      </ViewToolbar>

      <ViewContent className="p-6">
        <ViewHeader
          title="Known Hosts"
          description="Manage SSH known host fingerprints"
        />

        <EmptyState
          icon={<Fingerprint className="size-12" />}
          title="No known hosts"
          description="Import hosts from your SSH known_hosts file"
          action={
            <Button>
              <Upload className="size-4 mr-1" data-icon="inline-start" />
              Import
            </Button>
          }
        />
      </ViewContent>
    </ViewContainer>
  );
};

export default KnownHostsView;
