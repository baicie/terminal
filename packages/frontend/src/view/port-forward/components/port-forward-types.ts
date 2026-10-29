export type PortForwardType = 'local' | 'remote' | 'dynamic'

export interface PortForwardEntry {
  id: string
  name: string
  type: PortForwardType
  localHost: string
  localPort: number
  remoteHost: string
  remotePort: number
  active: boolean
  hostId?: string
  hostName?: string
  sessionId?: string
}

export interface PortForwardFormState {
  type: PortForwardType
  name: string
  localHost: string
  localPort: string
  remoteHost: string
  remotePort: string
  hostId: string
}

export const initialFormState: PortForwardFormState = {
  type: 'local',
  name: '',
  localHost: '127.0.0.1',
  localPort: '8080',
  remoteHost: '',
  remotePort: '',
  hostId: '',
}
