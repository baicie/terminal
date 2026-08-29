import { Copy, Eye, EyeOff, Server, Shield, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { VaultsContainerController } from './use-vaults-container'

export function VaultEntryDetail({
  vault,
}: {
  vault: VaultsContainerController
}) {
  const entry = vault.selectedEntry
  if (!entry) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <Shield className="size-12 mx-auto mb-4 opacity-50" />
          <p>Select an entry to view details</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 min-w-0">
      <div className="bg-card border rounded-xl p-6">
        <div className="flex items-start justify-between mb-6">
          <div>
            <h3 className="text-lg font-semibold">Entry Details</h3>
            <p className="text-sm text-muted-foreground mt-1 font-mono truncate">
              {entry.key}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void vault.handleCopy(entry.value)}
              title="Copy value"
            >
              <Copy className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="hover:text-destructive"
              onClick={() => {
                vault.setEntryToDelete(entry)
                vault.setDeleteDialogOpen(true)
              }}
              title="Delete entry"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground">Value</Label>
            <div className="relative">
              <Textarea
                className="font-mono text-sm min-h-[100px] pr-12"
                value={entry.value}
                readOnly
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2"
                onClick={() => vault.setShowPassword(!vault.showPassword)}
              >
                {vault.showPassword ? (
                  <EyeOff className="size-4" />
                ) : (
                  <Eye className="size-4" />
                )}
              </Button>
            </div>
          </div>
          {entry.key.startsWith('host:') && (
            <div className="pt-4 border-t">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const hostId = entry.key.split(':')[1]
                  if (hostId) void vault.handleAutofillHost(hostId)
                }}
              >
                <Server className="size-4 mr-1" />
                Autofill Host Credentials
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
