import type { SerialConfig, SerialPortInfo } from '@/service/serial'
import { Plug, RefreshCw, Usb } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
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
import { terminalSessionManager } from '@/features/terminal/services/terminal-session-manager'

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
  const { t } = useTranslation()
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

  const loadPorts = useCallback(async () => {
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
      setError(t('serial.failedLoadPorts'))
    }
    setLoading(false)
  }, [t])

  useEffect(() => {
    if (open) {
      void loadPorts()
    }
  }, [open, loadPorts])

  const handleConnect = async () => {
    if (!selectedPort) {
      setError(t('serial.selectPortRequired'))
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

    try {
      await terminalSessionManager.prepare('serial')
      const result = await serialService.connect(config)

      if (result.success && result.sessionId) {
        onConnect(config, result.sessionId)
        onClose()
      } else {
        setError(result.message || t('serial.connectionFailed'))
      }
    } catch (connectError) {
      setError(
        connectError instanceof Error
          ? connectError.message
          : String(connectError),
      )
    } finally {
      setConnecting(false)
    }
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
            <Plug className="size-5" />
            {t('serial.connectSerialPort')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Port Selection */}
          <div className="space-y-2">
            <Label htmlFor="port">{t('serial.serialPort')}</Label>
            <div className="flex gap-2">
              <Select value={selectedPort} onValueChange={setSelectedPort}>
                <SelectTrigger id="port" className="flex-1">
                  <SelectValue placeholder={t('serial.selectPort')} />
                </SelectTrigger>
                <SelectContent>
                  {ports.length === 0 ? (
                    <SelectItem value="no-ports" disabled>
                      {t('serial.noPortsAvailable')}
                    </SelectItem>
                  ) : (
                    ports.map(port => (
                      <SelectItem key={port.name} value={port.name}>
                        <div className="flex items-center gap-2">
                          <Usb className="size-4" />
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
                  className={`size-4 ${loading ? 'animate-spin' : ''}`}
                />
              </Button>
            </div>
          </div>

          {/* Baud Rate */}
          <div className="space-y-2">
            <Label htmlFor="baudRate">{t('serial.baudRate')}</Label>
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
            <Label htmlFor="dataBits">{t('serial.dataBits')}</Label>
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
            <Label htmlFor="stopBits">{t('serial.stopBits')}</Label>
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
            <Label htmlFor="parity">{t('serial.parity')}</Label>
            <Select value={parity} onValueChange={setParity}>
              <SelectTrigger id="parity">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('serial.none')}</SelectItem>
                <SelectItem value="odd">{t('serial.odd')}</SelectItem>
                <SelectItem value="even">{t('serial.even')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Flow Control */}
          <div className="space-y-2">
            <Label htmlFor="flowControl">{t('serial.flowControl')}</Label>
            <Select value={flowControl} onValueChange={setFlowControl}>
              <SelectTrigger id="flowControl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t('serial.none')}</SelectItem>
                <SelectItem value="hardware">
                  {t('serial.hardwareFlow')}
                </SelectItem>
                <SelectItem value="software">
                  {t('serial.softwareFlow')}
                </SelectItem>
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
          <Button variant="outline" type="button" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            onClick={handleConnect}
            disabled={connecting || !selectedPort}
          >
            {connecting ? (
              <>
                <RefreshCw className="size-4 mr-2 animate-spin" />
                {t('serial.connecting')}
              </>
            ) : (
              <>
                <Plug className="size-4 mr-2" />
                {t('serial.connect')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default SerialDialog
