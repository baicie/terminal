import type { SerialConfig, SerialPortInfo } from '@/service/serial'
import { Plug, RefreshCw, Usb } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { serialService } from '@/service/serial'

interface SerialDialogProps {
  open: boolean
  onClose: () => void
  onConnect: (config: SerialConfig, sessionId: string) => void
}

const SerialDialog: React.FC<SerialDialogProps> = ({
  open,
  onClose,
  onConnect,
}) => {
  const [ports, setPorts] = useState<SerialPortInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [selectedPort, setSelectedPort] = useState<string>('')
  const [baudRate, setBaudRate] = useState<number>(115200)
  const [dataBits, setDataBits] = useState<number>(8)
  const [stopBits, setStopBits] = useState<number>(1)
  const [parity, setParity] = useState<string>('none')
  const [flowControl, setFlowControl] = useState<string>('none')
  const [error, setError] = useState<string | null>(null)

  const baudRates = [
    300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800,
    921600,
  ]

  useEffect(() => {
    if (open) {
      loadPorts()
    }
  }, [open])

  const loadPorts = async () => {
    setLoading(true)
    setError(null)
    try {
      const availablePorts = await serialService.listPorts()
      setPorts(availablePorts)
      if (availablePorts.length > 0) {
        setSelectedPort(availablePorts[0].name)
      } else {
        setSelectedPort('')
      }
    } catch (err) {
      console.error('Failed to load ports:', err)
      setError('Failed to load serial ports')
    }
    setLoading(false)
  }

  const handleConnect = async () => {
    if (!selectedPort) {
      setError('Please select a serial port')
      return
    }

    setConnecting(true)
    setError(null)

    const config: SerialConfig = {
      name: selectedPort,
      baudRate,
      dataBits,
      stopBits,
      parity,
      flowControl,
    }

    const result = await serialService.connect(config)

    if (result.success && result.sessionId) {
      onConnect(config, result.sessionId)
      onClose()
    } else {
      setError(result.message || 'Connection failed')
    }

    setConnecting(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={isOpen => {
        if (!isOpen) onClose()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" />
            Connect Serial Port
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Port Selection */}
          <div className="space-y-2">
            <Label htmlFor="port">Serial Port</Label>
            <div className="flex gap-2">
              <Select value={selectedPort} onValueChange={setSelectedPort}>
                <SelectTrigger id="port" className="flex-1">
                  <SelectValue placeholder="Select a port" />
                </SelectTrigger>
                <SelectContent>
                  {ports.length === 0 ? (
                    <SelectItem value="no-ports" disabled>
                      No ports available
                    </SelectItem>
                  ) : (
                    ports.map(port => (
                      <SelectItem key={port.name} value={port.name}>
                        <div className="flex items-center gap-2">
                          <Usb className="h-4 w-4" />
                          <span>{port.name}</span>
                          <span className="text-muted-foreground text-xs">
                            ({port.port_type})
                          </span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="icon"
                onClick={loadPorts}
                disabled={loading}
              >
                <RefreshCw
                  className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}
                />
              </Button>
            </div>
          </div>

          {/* Baud Rate */}
          <div className="space-y-2">
            <Label htmlFor="baudRate">Baud Rate</Label>
            <Select
              value={String(baudRate)}
              onValueChange={v => setBaudRate(Number(v))}
            >
              <SelectTrigger id="baudRate">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {baudRates.map(rate => (
                  <SelectItem key={rate} value={String(rate)}>
                    {rate}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Data Bits */}
          <div className="space-y-2">
            <Label htmlFor="dataBits">Data Bits</Label>
            <Select
              value={String(dataBits)}
              onValueChange={v => setDataBits(Number(v))}
            >
              <SelectTrigger id="dataBits">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">5</SelectItem>
                <SelectItem value="6">6</SelectItem>
                <SelectItem value="7">7</SelectItem>
                <SelectItem value="8">8</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Stop Bits */}
          <div className="space-y-2">
            <Label htmlFor="stopBits">Stop Bits</Label>
            <Select
              value={String(stopBits)}
              onValueChange={v => setStopBits(Number(v))}
            >
              <SelectTrigger id="stopBits">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1</SelectItem>
                <SelectItem value="2">2</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Parity */}
          <div className="space-y-2">
            <Label htmlFor="parity">Parity</Label>
            <Select value={parity} onValueChange={setParity}>
              <SelectTrigger id="parity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="odd">Odd</SelectItem>
                <SelectItem value="even">Even</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Flow Control */}
          <div className="space-y-2">
            <Label htmlFor="flowControl">Flow Control</Label>
            <Select value={flowControl} onValueChange={setFlowControl}>
              <SelectTrigger id="flowControl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                <SelectItem value="hardware">Hardware (RTS/CTS)</SelectItem>
                <SelectItem value="software">Software (XON/XOFF)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Error Message */}
          {error && (
            <div className="p-3 bg-destructive/10 rounded-lg">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={handleConnect}
            disabled={connecting || !selectedPort}
          >
            {connecting ? (
              <>
                <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                Connecting...
              </>
            ) : (
              <>
                <Plug className="h-4 w-4 mr-2" />
                Connect
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SerialDialog
