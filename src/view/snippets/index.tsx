import { ViewContainer, ViewToolbar, ViewContent, ViewHeader } from "@/components/view-container";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus } from "lucide-react";
import SnippetManager from "@/components/snippet-manager";
import { useState } from "react";

const SnippetsView: React.FC = () => {
  const [snippetManagerOpen, setSnippetManagerOpen] = useState(false);

  return (
    <ViewContainer>
      <ViewToolbar className="gap-4">
        <Input placeholder="Search snippets..." className="max-w-xs h-9" />
        <div className="flex-1" />
        <Button size="sm" onClick={() => setSnippetManagerOpen(true)}>
          <Plus className="size-4 mr-1" data-icon="inline-start" />
          New Snippet
        </Button>
      </ViewToolbar>

      <ViewContent className="p-6">
        <ViewHeader
          title="Snippets"
          description="Manage reusable command scripts"
        />

        <SnippetManager
          open={snippetManagerOpen}
          onClose={() => setSnippetManagerOpen(false)}
          onExecute={(script) => {
            console.log("Execute snippet:", script);
          }}
        />
      </ViewContent>
    </ViewContainer>
  );
};

export default SnippetsView;
