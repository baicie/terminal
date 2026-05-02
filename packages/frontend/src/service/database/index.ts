/**
 * 数据库模块
 * 统一导出所有数据库相关函数
 */

// 基础连接和查询
export { getDb, executeQuery, select } from './connection'

// 初始化和配置
export { initSchema, configureSqlite } from './connection'

// Hosts CRUD
export {
  getHosts,
  getHostById,
  createHost,
  updateHost,
  deleteHost,
  searchHosts,
  getHostsByGroup,
  getFavoriteHosts,
} from './hosts'

// Groups CRUD
export {
  getGroups,
  getGroupById,
  createGroup,
  updateGroup,
  deleteGroup,
  getChildGroups,
} from './groups'

// Types
export type {
  HostRecord,
  GroupRecord,
  WorkspaceRecord,
  CommandHistoryRecord,
  KnownHostRecord,
  SnippetRecord,
  SnippetPackageRecord,
  SSHKeyRecord,
  AppSettings,
  ConnectionLogRecord,
  ScriptRecord,
  ScriptExecutionRecord,
  TeamRecord,
  TeamMemberRecord,
  TeamSharedHostRecord,
  TeamSharedSnippetRecord,
  TeamInviteRecord,
  TeamAuditLogRecord,
  SyncQueueRecord,
  UserProfileRecord,
  WorkspaceLayoutRecord,
  TerminalThemePreset,
} from './types'

// Settings
export {
  getSetting,
  setSetting,
  getAppSettings,
  saveAppSettings,
  defaultSettings,
} from './settings'

// Command History
export {
  addCommandHistory,
  getCommandHistory,
  searchCommandHistory,
  clearCommandHistory,
} from './command-history'

// Known Hosts
export {
  addKnownHost,
  addKnownHosts,
  getKnownHosts,
  searchKnownHosts,
  deleteKnownHost,
  clearAllKnownHosts,
} from './known-hosts'

// Snippets
export {
  getSnippets,
  getSnippetById,
  createSnippet,
  updateSnippet,
  deleteSnippet,
  searchSnippets,
  getSnippetPackages,
  createSnippetPackage,
  deleteSnippetPackage,
} from './snippets'

// SSH Keys
export {
  getSSHKeys,
  getSSHKeyById,
  createSSHKey,
  updateSSHKey,
  deleteSSHKey,
  searchSSHKeys,
} from './ssh-keys'

// Workspaces
export {
  getWorkspaces,
  getActiveWorkspace,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace,
  setActiveWorkspace,
  getWorkspaceLayout,
  saveWorkspaceLayout,
} from './workspaces'

// Connection Logs
export {
  getConnectionLogs,
  getConnectionLogsByHost,
  addConnectionLog,
  updateConnectionLog,
  deleteConnectionLog,
  clearConnectionLogs,
  searchConnectionLogs,
  toggleConnectionLogSaved,
} from './connection-logs'

// Scripts
export {
  getScripts,
  getScriptById,
  createScript,
  updateScript,
  deleteScript,
  searchScripts,
  getEnabledScripts,
  toggleScriptEnabled,
  getScriptExecutions,
  getScriptExecutionById,
  addScriptExecution,
  updateScriptExecution,
  deleteScriptExecution,
  clearScriptExecutions,
} from './scripts'

// Team
export {
  getTeams,
  getTeamById,
  createTeam,
  updateTeam,
  deleteTeam,
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
  updateTeamMember,
  getSharedHosts,
  addSharedHost,
  removeSharedHost,
  getSharedSnippets,
  addSharedSnippet,
  removeSharedSnippet,
  getTeamInvites,
  createTeamInvite,
  deleteTeamInvite,
  getTeamInviteByCode,
  getTeamInviteByToken,
  markInviteUsed,
  getTeamAuditLogs,
  addTeamAuditLog,
  getPendingSyncItems,
  addSyncQueueItem,
  updateSyncQueueItem,
  getUserProfile,
  createUserProfile,
  updateUserProfile,
} from './teams'
