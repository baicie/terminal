import app from './app'
import cmdPalette from './cmdPalette'
import home from './home'
import hosts from './hosts'
import keychain from './keychain'
import knownHosts from './knownHosts'
import logs from './logs'
import portForward from './portForward'
import serial from './serial'
import settings from './settings'
import sftp from './sftp'
import snippets from './snippets'
import startup from './startup'
import teams from './teams'
import terminalStatus from './terminalStatus'
import vaults from './vaults'
import workspace from './workspace'

export default {
  ...app,
  ...cmdPalette,
  ...home,
  ...hosts,
  ...keychain,
  ...knownHosts,
  ...logs,
  ...portForward,
  ...serial,
  ...settings,
  ...sftp,
  ...snippets,
  ...startup,
  ...teams,
  ...terminalStatus,
  ...vaults,
  ...workspace,
}
