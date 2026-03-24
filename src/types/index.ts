// Host types based on design.md

export type AuthType = 'password' | 'key' | 'agent'

export type PortForwardType = 'local' | 'remote' | 'dynamic'

export interface PortForward {
  id: string
  name: string
  type: PortForwardType
  localPort?: number
  localHost?: string
  remotePort?: number
  remoteHost?: string
  active: boolean
}

// Port forward config for backend
export interface PortForwardConfig {
  id: string
  name: string
  forward_type: PortForwardType
  local_host: string
  local_port: number
  remote_host: string
  remote_port: number
}

export interface Host {
  id: string
  name: string
  hostname: string
  port: number
  username: string
  authType: AuthType
  password?: string
  privateKey?: string
  groupId?: string
  isFavorite: boolean
  color?: string
  tags?: string[]
  portForwards: PortForward[]
  startupCommand?: string
  environment?: Record<string, string>
  // Jump host configuration
  jumpHostId?: string // ID of the jump/bastion host to use
  jumpHostAuthType?: AuthType // Override auth type for jump host (optional)
  createdAt: number
  updatedAt: number
}

export interface Group {
  id: string
  name: string
  parentId?: string
  color?: string
  inheritSettings: boolean
  settings?: HostSettings
  order: number
}

export interface HostSettings {
  port?: number
  authType?: AuthType
  privateKey?: string
}

export interface Snippet {
  id: string
  name: string
  description?: string
  script: string
  packageId?: string
  tags?: string[]
  variables?: Variable[]
}

export interface SnippetPackage {
  id: string
  name: string
  description?: string
}

export interface Variable {
  name: string
  defaultValue?: string
  description?: string
}

export interface Tab {
  id: string
  label: string
  type: 'local' | 'remote' | 'serial'
  hostId?: string
  serialSessionId?: string // Serial session ID when type is 'serial'
  serialConfig?: SerialTabConfig // Serial port config for display
  connectionStatus?: 'connected' | 'disconnected' | 'connecting'
  // Split screen support
  splitMode?: 'none' | 'horizontal' | 'vertical'
  splitId?: string // ID of the split group this tab belongs to
  splitChildren?: string[] // IDs of child tabs in split mode
}

export interface SerialTabConfig {
  port: string
  baudRate: number
}

export interface SplitGroup {
  id: string
  mode: 'horizontal' | 'vertical'
  tabs: string[] // Tab IDs in this split group
  sizes?: number[] // Optional sizes for each pane
}

// Workspace for multi-workspace support
export interface Workspace {
  id: string
  name: string
  description?: string
  icon?: string // Emoji or icon name
  color?: string // Color for the workspace
  order: number // Display order
  isActive: boolean // Is this the current workspace
  createdAt: number
  updatedAt: number
}

// Layout saved with workspace
export interface WorkspaceLayout {
  workspaceId: string
  tabs: Tab[]
  splitGroups: SplitGroup[]
  activeTabId: string | null
  sidebarVisible: boolean
}
