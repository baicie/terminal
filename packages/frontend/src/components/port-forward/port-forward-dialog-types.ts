import type { PortForward, PortForwardType } from '@/types'

export interface PortForwardFormData {
  name: string
  type: PortForwardType
  localPort: string
  localHost: string
  remotePort: string
  remoteHost: string
}

export function createEmptyPortForwardForm(): PortForwardFormData {
  return {
    name: '',
    type: 'local',
    localPort: '',
    localHost: 'localhost',
    remotePort: '',
    remoteHost: 'localhost',
  }
}

export function getPortForwardTypeLabel(type: PortForwardType): string {
  switch (type) {
    case 'local':
      return 'Local (-L)'
    case 'remote':
      return 'Remote (-R)'
    case 'dynamic':
      return 'Dynamic (-D)'
    default:
      return type
  }
}

export function getPortForwardDescription(forward: PortForward): string {
  switch (forward.type) {
    case 'local':
      return `${forward.localHost}:${forward.localPort} → ${forward.remoteHost}:${forward.remotePort}`
    case 'remote':
      return `${forward.remoteHost}:${forward.remotePort} → ${forward.localHost}:${forward.localPort}`
    case 'dynamic':
      return `${forward.localHost}:${forward.localPort} (SOCKS)`
    default:
      return ''
  }
}
