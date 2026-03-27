import { Network, Plus, Trash2 } from 'lucide-react'
import * as React from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface EnvironmentVariablesDialogProps {
  open: boolean
  onClose: () => void
  envVars: Array<{ key: string; value: string }>
  onSave: (envVars: Array<{ key: string; value: string }>) => void
}

export const EnvironmentVariablesDialog: React.FC<
  EnvironmentVariablesDialogProps
> = ({ open, onClose, envVars, onSave }) => {
  const [localEnvVars, setLocalEnvVars] = useState(envVars)

  React.useEffect(() => {
    if (open) {
      setLocalEnvVars(envVars)
    }
  }, [open, envVars])

  const handleAddVariable = () => {
    setLocalEnvVars([...localEnvVars, { key: '', value: '' }])
  }

  const handleRemoveVariable = (index: number) => {
    setLocalEnvVars(localEnvVars.filter((_, i) => i !== index))
  }

  const handleKeyChange = (index: number, value: string) => {
    const updated = [...localEnvVars]
    updated[index].key = value
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '')
    setLocalEnvVars(updated)
  }

  const handleValueChange = (index: number, value: string) => {
    const updated = [...localEnvVars]
    updated[index].value = value
    setLocalEnvVars(updated)
  }

  const handleSave = () => {
    const envRecord: Record<string, string> = {}
    for (const { key, value } of localEnvVars) {
      if (key.trim()) {
        envRecord[key.trim()] = value
      }
    }
    onSave(
      Object.keys(envRecord).length > 0
        ? localEnvVars.filter(v => v.key.trim())
        : [],
    )
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="size-5" />
            Environment Variables
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-80 overflow-y-auto py-2">
          {localEnvVars.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No environment variables configured. Click "Add Variable" to add
              one.
            </p>
          ) : (
            localEnvVars.map((env, index) => (
              <div key={index} className="flex gap-2 items-center">
                <Input
                  placeholder="KEY"
                  value={env.key}
                  onChange={e => handleKeyChange(index, e.target.value)}
                  className="flex-1 font-mono text-sm"
                />
                <span className="text-muted-foreground">=</span>
                <Input
                  placeholder="value"
                  value={env.value}
                  onChange={e => handleValueChange(index, e.target.value)}
                  className="flex-1 font-mono text-sm"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0 text-destructive"
                  onClick={() => handleRemoveVariable(index)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))
          )}

          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={handleAddVariable}
          >
            <Plus className="size-4 mr-1" data-icon="inline-start" />
            Add Variable
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
