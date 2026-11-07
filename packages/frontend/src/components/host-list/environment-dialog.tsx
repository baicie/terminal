import { Network, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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

interface EnvVarRow {
  id: string
  key: string
  value: string
}

let envVarRowSeq = 0

function toEnvVarRow(variable: { key: string; value: string }): EnvVarRow {
  envVarRowSeq += 1
  return { ...variable, id: `env-var-${envVarRowSeq}` }
}

interface EnvironmentVariablesDialogProps {
  open: boolean
  onClose: () => void
  envVars: Array<{ key: string; value: string }>
  onSave: (envVars: Array<{ key: string; value: string }>) => void
}

export const EnvironmentVariablesDialog: React.FC<
  EnvironmentVariablesDialogProps
> = ({ open, onClose, envVars, onSave }) => {
  const { t } = useTranslation()
  const [localEnvVars, setLocalEnvVars] = useState<EnvVarRow[]>(() =>
    envVars.map(toEnvVarRow),
  )

  React.useEffect(() => {
    if (open) {
      setLocalEnvVars(envVars.map(toEnvVarRow))
    }
  }, [open, envVars])

  const handleAddVariable = () => {
    setLocalEnvVars([...localEnvVars, toEnvVarRow({ key: '', value: '' })])
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
        ? localEnvVars
            .filter(v => v.key.trim())
            .map(({ key, value }) => ({ key, value }))
        : [],
    )
    onClose()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Network className="size-5" />
            {t('hosts.form.environment')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-80 overflow-y-auto py-2">
          {localEnvVars.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              {t('hosts.form.environmentEmpty')}
            </p>
          ) : (
            localEnvVars.map((env, index) => (
              <div key={env.id} className="flex gap-2 items-center">
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
            {t('hosts.form.addVariable')}
          </Button>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave}>{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
