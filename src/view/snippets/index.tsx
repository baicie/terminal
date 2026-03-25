import { Plus } from 'lucide-react'
import { useState } from 'react'
import SnippetManager from '@/components/snippet-manager'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  ViewContainer,
  ViewContent,
  ViewHeader,
  ViewToolbar,
} from '@/components/view-container'

const SnippetsView: React.FC = () => {
  const [snippetManagerOpen, setSnippetManagerOpen] = useState(false)

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
          onExecute={_script => {
          // script execution handled by parent
        }}
        />
      </ViewContent>
    </ViewContainer>
  )
}

export default SnippetsView
