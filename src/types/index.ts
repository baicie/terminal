// Host types based on design.md

export type AuthType = 'password' | 'key' | 'agent';

export type PortForwardType = 'local' | 'remote' | 'dynamic';

export interface PortForward {
  id: string;
  name: string;
  type: PortForwardType;
  localPort?: number;
  localHost?: string;
  remotePort?: number;
  remoteHost?: string;
  active: boolean;
}

export interface Host {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authType: AuthType;
  password?: string;
  privateKey?: string;
  groupId?: string;
  isFavorite: boolean;
  color?: string;
  tags?: string[];
  portForwards: PortForward[];
  startupCommand?: string;
  environment?: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface Group {
  id: string;
  name: string;
  parentId?: string;
  color?: string;
  inheritSettings: boolean;
  settings?: HostSettings;
  order: number;
}

export interface HostSettings {
  port?: number;
  authType?: AuthType;
  privateKey?: string;
}

export interface Snippet {
  id: string;
  name: string;
  description?: string;
  script: string;
  packageId?: string;
  tags?: string[];
  variables?: Variable[];
}

export interface SnippetPackage {
  id: string;
  name: string;
  description?: string;
}

export interface Variable {
  name: string;
  defaultValue?: string;
  description?: string;
}

export interface Tab {
  id: string;
  label: string;
  type: 'local' | 'remote';
  hostId?: string;
  connectionStatus?: 'connected' | 'disconnected' | 'connecting';
  // Split screen support
  splitMode?: 'none' | 'horizontal' | 'vertical';
  splitId?: string;  // ID of the split group this tab belongs to
  splitChildren?: string[];  // IDs of child tabs in split mode
}

export interface SplitGroup {
  id: string;
  mode: 'horizontal' | 'vertical';
  tabs: string[];  // Tab IDs in this split group
  sizes?: number[];  // Optional sizes for each pane
}
