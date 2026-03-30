import type { SnippetRecord } from '@/service/database'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface SnippetExecuteDialogProps {
  open: boolean
  onClose: () => void
  snippet: SnippetRecord
  variableValues: Record<string, string>
  onVariableChange: (values: Record<string, string>) => void
  onExecute: () => void
}

// Parse variables from script (format: ${VAR_NAME} or $VAR_NAME)
function parseVariables(script: string): string[] {
  const variables = new Set<string>()
  const regex = /\$\{?([A-Z_]\w*)\}?/gi
  let match
  while ((match = regex.exec(script)) !== null) {
    variables.add(match[1])
  }
  return Array.from(variables)
}

export const SnippetExecuteDialog: React.FC<SnippetExecuteDialogProps> = ({
  open,
  onClose,
  snippet,
  variableValues,
  onVariableChange,
  onExecute,
}) => {
  const variables = parseVariables(snippet.script)

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Execute Snippet - Set Variables</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            Enter values for the variables in this snippet:
          </div>

          <div className="text-xs font-mono bg-muted p-2 rounded">
            {snippet.script}
          </div>

          <div className="space-y-3">
            {variables.map(varName => (
              <div key={varName}>
                <Label htmlFor={`var-${varName}`}>{varName}</Label>
                <Input
                  id={`var-${varName}`}
                  value={variableValues[varName] || ''}
                  onChange={e =>
                    onVariableChange({
                      ...variableValues,
                      [varName]: e.target.value,
                    })
                  }
                  placeholder={`Enter ${varName}`}
                />
              </div>
            ))}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DialogClose>
          <Button type="button" onClick={onExecute}>
            <Play className="h-4 w-4 mr-1" />
            Execute
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Export the parse function for use in parent component
export { parseVariables }
