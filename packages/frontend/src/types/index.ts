import type { CredentialRef, CredentialRefProblem } from '@/service/credential-boundary'

// Host types based on design.md

export type AuthType = 'password' | 'key' | 'agent' | 'cert'

/** Explicit remote shell integration mode. Disabled unless the host opts in. */
export type ShellIntegrationMode = 'off' | 'bash' | 'zsh'

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
  /**
   * A secret typed into a form that has not been saved yet.
   *
   * It is never persisted: the save path moves it to the vault and stores only
   * `credentialRef`. A host read back from the database has this undefined.
   */
  password?: string
  privateKey?: string
  /**
   * A path to a key file the *user* keeps outside the app, from an OpenSSH
   * import (`IdentityFile`).
   *
   * This is deliberately not `privateKey`: that field means key material and is
   * handed to the SSH layer as-is, so a path there fails at connect time with a
   * parser error that names nothing useful. The connection resolves this field
   * by reading the file, and the row never claims to store a secret it does not
   * have.
   */
  identityFilePath?: string
  /**
   * Where this host's secrets live. Absent/null means "none stored" — agent
   * authentication, or a password asked at connect time.
   */
  credentialRef?: CredentialRef | null
  /**
   * Why `credentialRef` could not be read, when the column holds something that is
   * not a usable reference.
   *
   * Present means the host *does* have a stored credential this build cannot
   * resolve — a corrupt pointer, an unknown provider, a version from a newer build.
   * The connect path refuses with this rather than falling back to an empty
   * password, because an empty password turns a data problem into a login failure
   * the user cannot diagnose.
   */
  credentialRefProblem?: CredentialRefProblem | null
  /**
   * Update-only: delete the stored credential. Distinct from "no secret in this
   * update", which leaves the existing one alone.
   */
  clearCredential?: boolean
  /** SSH 证书（OpenSSH 格式 base64 字符串） */
  certificate?: string
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
  /** Forward the local SSH agent to this host. Independent of login auth. */
  agentForwarding?: boolean
  /** Inject shell integration markers for the selected remote shell. */
  shellIntegration?: ShellIntegrationMode
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
  /** Temporary empty-workspace startup fallback; never persisted by recovery. */
  startupFallback?: boolean
  /**
   * The user typed into this startup fallback. It is still app-owned, but a
   * late remote restore must keep it instead of replacing it (Issue #184).
   */
  startupFallbackInteracted?: boolean
  /** Process-local OSC 0/2 title; workspace recovery intentionally drops it. */
  title?: string
  type: 'local' | 'remote' | 'serial'
  hostId?: string
  /** Process-local profile reference. Credentials never belong in a tab. */
  profileId?: string
  serialSessionId?: string // Serial session ID when type is 'serial'
  serialConfig?: SerialTabConfig // Serial port config for display
  connectionStatus?:
    | 'connected'
    | 'disconnected'
    | 'connecting'
    | 'reconnecting'
    | 'error'
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
