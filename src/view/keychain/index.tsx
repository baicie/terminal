import { ViewContainer, ViewToolbar, ViewContent, ViewHeader, EmptyState } from "@/components/view-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Key, Plus, Upload } from "lucide-react";

const KeychainView: React.FC = () => {
  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <Input placeholder="Search keys..." className="max-w-xs h-9" />
        <div className="flex-1" />
        <Button variant="outline" size="sm">
          <Upload className="size-4 mr-1" data-icon="inline-start" />
          Import
        </Button>
        <Button size="sm">
          <Plus className="size-4 mr-1" data-icon="inline-start" />
          New Key
        </Button>
      </ViewToolbar>

      <ViewContent className="p-6">
        <ViewHeader
          title="Keychain"
          description="Manage your SSH keys and certificates"
        />

        <EmptyState
          icon={<Key className="size-12" />}
          title="No keys yet"
          description="Add your first SSH key to get started"
          action={
            <Button>
              <Plus className="size-4 mr-1" data-icon="inline-start" />
              Add Key
            </Button>
          }
        />
      </ViewContent>
    </ViewContainer>
  );
};

export default KeychainView;
