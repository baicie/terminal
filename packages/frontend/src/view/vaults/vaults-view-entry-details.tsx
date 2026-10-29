import type { VaultEntry } from '@/service/vault'
import { Copy, Eye, EyeOff, KeyRound, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

interface VaultsViewEntryDetailsProps {
  entry: VaultEntry | null
  showValue: boolean
  onShowValueChange: (value: boolean) => void
  onCopyValue: (value: string) => void
}

export function VaultsViewEntryDetails({
  entry,
  showValue,
  onShowValueChange,
  onCopyValue,
}: VaultsViewEntryDetailsProps) {
  if (!entry) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <div className="text-center">
          <KeyRound className="mx-auto mb-2 size-10 opacity-50" />
          <p>Select an entry to view details</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="border-b p-4">
        <h4 className="flex items-center gap-2 font-medium">
          <Server />
          Entry Details
        </h4>
      </div>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
        <div className="flex flex-col gap-2">
          <Label>Key</Label>
          <div className="break-all rounded-lg bg-muted p-3 font-mono text-sm">
            {entry.key}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label>Value</Label>
          <div className="flex gap-2">
            <div className="flex-1 break-all rounded-lg bg-muted p-3 font-mono text-sm">
              {showValue ? entry.value : '••••••••••••'}
            </div>
            <Button
              variant="outline"
              size="icon"
              aria-label={showValue ? 'Hide value' : 'Show value'}
              onClick={() => onShowValueChange(!showValue)}
            >
              {showValue ? <EyeOff /> : <Eye />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Copy value"
              onClick={() => onCopyValue(entry.value)}
            >
              <Copy />
            </Button>
          </div>
        </div>
        {entry.description && (
          <div className="flex flex-col gap-2">
            <Label>Description</Label>
            <p className="text-sm text-muted-foreground">{entry.description}</p>
          </div>
        )}
      </div>
    </>
  )
}
