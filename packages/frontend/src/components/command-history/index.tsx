import type { CommandHistoryRecord } from '@/service/database'
import { Clock, Search, Terminal, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  clearCommandHistory,
  getCommandHistory,
  searchCommandHistory,
} from '@/service/database'

interface CommandHistoryDialogProps {
  open: boolean
  onClose: () => void
  onSelect?: (command: string) => void
}

const CommandHistoryDialog: React.FC<CommandHistoryDialogProps> = ({
  open,
  onClose,
  onSelect,
}) => {
  const [history, setHistory] = useState<CommandHistoryRecord[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(false)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    try {
      let records: CommandHistoryRecord[]
      if (searchQuery) {
        records = await searchCommandHistory(searchQuery, 50)
      } else {
        records = await getCommandHistory(undefined, 100)
      }
      setHistory(records)
    } catch (error) {
      console.error('Failed to load command history:', error)
    } finally {
      setLoading(false)
    }
  }, [searchQuery])

  useEffect(() => {
    if (open) {
      void loadHistory()
    }
  }, [open, loadHistory])

  const handleClearHistory = async () => {
    try {
      await clearCommandHistory()
      setHistory([])
    } catch (error) {
      console.error('Failed to clear history:', error)
    }
  }

  const handleSelectCommand = (command: string) => {
    if (onSelect) {
      onSelect(command)
    }
    onClose()
  }

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 60000) return 'Just now'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} hours ago`
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} days ago`

    return date.toLocaleDateString()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) onClose()
      }}
    >
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Command History
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search commands..."
              className="pl-8"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-1 top-1/2 -translate-y-1/2 size-6"
                onClick={() => setSearchQuery('')}
              >
                <X className="size-3" />
              </Button>
            )}
          </div>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="icon" title="Clear history">
                <Trash2 className="h-4 w-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Clear Command History</AlertDialogTitle>
                <AlertDialogDescription>
                  Are you sure you want to clear all command history? This
                  action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleClearHistory}>
                  Clear
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="text-center text-muted-foreground py-8">
              Loading...
            </div>
          ) : history.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              {searchQuery ? 'No commands found' : 'No command history'}
            </div>
          ) : (
            <div className="space-y-1">
              {history.map((record, index) => (
                <div
                  key={record.id || index}
                  className="flex items-start gap-3 p-2 rounded hover:bg-accent/50 cursor-pointer group"
                  onClick={() => handleSelectCommand(record.command)}
                >
                  <Terminal className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm truncate">
                      {record.command}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {formatDate(record.executed_at)}
                      {record.host_id &&
                        ` • Host: ${record.host_id.substring(0, 8)}...`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-xs text-muted-foreground text-center pt-2 border-t">
          {history.length} command
          {history.length !== 1 ? 's' : ''} in history
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default CommandHistoryDialog
