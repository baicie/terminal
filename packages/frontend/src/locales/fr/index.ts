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
import teams from './teams'
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
  ...teams,
  ...vaults,
  ...workspace,
}
