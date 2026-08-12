export default {
  // App layout
  'app.name': 'Terminal',
  'app.version': 'Terminal v1.0',

  // Navigation sidebar
  'nav.hosts': 'Hosts',
  'nav.teams': 'Teams',
  'nav.keychain': 'Keychain',
  'nav.portForward': 'Port Forwarding',
  'nav.snippets': 'Snippets',
  'nav.knownHosts': 'Known Hosts',
  'nav.logs': 'Logs',
  'nav.sftp': 'SFTP',
  'nav.scripts': 'Scripts',
  'nav.settings': 'Settings',
  'nav.experiments': 'Experiments',

  // Top toolbar
  'toolbar.toggleSidebar': 'Toggle sidebar',
  'toolbar.sftp': 'SFTP',
  'toolbar.newTab': 'New tab',
  'toolbar.more': 'More',
  'toolbar.serial': 'Serial',
  'toolbar.commandPalette': 'Command palette',
  'toolbar.commandHistory': 'Command history',
  'toolbar.notifications': 'Notifications',

  // Tabs
  'tabs.splitVertical': 'Split Vertical',
  'tabs.splitHorizontal': 'Split Horizontal',
  'tabs.closeSplit': 'Close Split',
  'tabs.home': 'Home',

  // Shortcuts help dialog
  'shortcuts.title': 'Keyboard Shortcuts',
  'shortcuts.description':
    'All available shortcuts. Press ? or Cmd/Ctrl + / to open this panel any time.',
  'shortcuts.search': 'Search shortcuts...',
  'shortcuts.empty': 'No matching shortcuts',
  'shortcuts.action': 'Action',
  'shortcuts.keys': 'Keys',

  // Terminal context menu
  'terminal.copy': 'Copy',
  'terminal.paste': 'Paste',
  'terminal.selectAll': 'Select All',
  'terminal.clear': 'Clear',
  'terminal.search': 'Find',
  'terminal.zoomIn': 'Zoom In',
  'terminal.zoomOut': 'Zoom Out',
  'terminal.showTools': 'Show tools',
  'terminal.hideTools': 'Hide tools',
  'terminal.fullscreen': 'Fullscreen',
  'terminal.exitFullscreen': 'Exit fullscreen',
  'terminal.resetZoom': 'Reset Zoom',
  'terminal.splitVertical': 'Split Vertical',
  'terminal.splitHorizontal': 'Split Horizontal',
  'terminal.closeTab': 'Close Tab',
  'terminal.copyEmpty': 'Nothing selected',
  'terminal.pasteEmpty': 'Clipboard is empty',
  'terminal.searchPlaceholder': 'Find in terminal…',
  'terminal.searchNext': 'Next match',
  'terminal.searchPrev': 'Previous match',
  'terminal.searchCaseSensitive': 'Match case',
  'terminal.searchWholeWord': 'Match whole word',
  'terminal.searchRegex': 'Use regular expression',
  'terminal.windowUnfocused':
    'Window unfocused — input still goes to the background terminal',

  // Settings
  'settings.copyOnSelect': 'Copy on Select',
  'settings.copyOnSelectDesc':
    'Automatically copy selected text to the clipboard',
  'settings.pasteOnMiddleClick': 'Paste on Middle Click',
  'settings.pasteOnMiddleClickDesc':
    'Paste clipboard content with the middle mouse button',
  'settings.allowProposedApi': 'Allow Proposed API',
  'settings.allowProposedApiDesc':
    'Enable xterm.js proposed APIs (required by image addon)',
  'settings.desktopSection': 'Desktop UX',
  'settings.minimizeToTray': 'Minimize to Tray on Close',
  'settings.minimizeToTrayDesc':
    'Hide the window instead of quitting; app keeps running in the tray',
  'settings.nativeNotifications': 'Native System Notifications',
  'settings.nativeNotificationsDesc':
    'Show OS-level toasts on disconnect or long-running task completion',
  'settings.notifyOnlyWhenUnfocused': 'Only When Window Unfocused',
  'settings.notifyOnlyWhenUnfocusedDesc':
    'Skip native notifications while the app window is focused',

  // Shortcuts
  'settings.shortcuts.tip':
    'Click a shortcut to rebind it. Press Escape to cancel.',
  'settings.shortcuts.recording': 'Recording...',
  'settings.shortcuts.enabled': 'On',
  'settings.shortcuts.disabled': 'Off',
  'settings.shortcuts.resetToDefault': 'Reset to default',
  'settings.shortcuts.resetAll': 'Reset All',
  'settings.shortcuts.searchPlaceholder': 'Search shortcuts...',
  'settings.shortcuts.noResults': 'No shortcuts found',
  'settings.shortcuts.conflictWith': 'Conflict with',
  'settings.shortcuts.resetSuccess': 'Shortcuts reset to defaults',
  'settings.shortcuts.recordingHint':
    'Press a key combination to bind, or Escape to cancel...',

  // SFTP transfer queue
  'sftp.transfersTitle': 'Transfers',
  'sftp.transferActive_one': '{{count}} active',
  'sftp.transferActive_other': '{{count}} active',
  'sftp.transferErrors_one': '{{count}} failed',
  'sftp.transferErrors_other': '{{count}} failed',
  'sftp.transferEta': '{{eta}} left',
  'sftp.transferDone': 'Completed',
  'sftp.clearFinished': 'Clear finished',
  'sftp.dropToUpload': 'Drop files to upload to {{path}}',

  // Common actions
  'common.save': 'Save',
  'common.cancel': 'Cancel',
  'common.delete': 'Delete',
  'common.edit': 'Edit',
  'common.add': 'Add',
  'common.new': 'New',
  'common.copied': 'Copied to clipboard',
  'common.refresh': 'Refresh',
  'common.search': 'Search',
  'common.loading': 'Loading...',
  'common.error': 'Error',
  'common.success': 'Success',
  'common.confirm': 'Confirm',
  'common.close': 'Close',
  'common.name': 'Name',
  'common.description': 'Description',
  'common.actions': 'Actions',
  'common.settings': 'Settings',
  'common.language': 'Language',
  'common.theme': 'Theme',
  'common.fontSize': 'Font Size',
  'common.fontFamily': 'Font Family',
  'common.cursorStyle': 'Cursor Style',
  'common.cursorBlink': 'Cursor Blink',
  'common.scrollback': 'Scrollback',
  'common.copyOnSelect': 'Copy on Select',
  'common.pasteOnMiddleClick': 'Paste on Middle Click',
  'common.allowProposedApi': 'Allow Proposed API',
  'common.retry': 'Retry',
  'common.goHome': 'Go Home',
  'common.errorOccurred': 'Something went wrong',

  // Error boundary
  'error.title': 'Failed to load page',
  'error.message': '{{message}}',

  // Common (for experiments)
  'common.back': 'Back',
  'common.clear': 'Clear',
  'common.on': 'ON',
  'common.off': 'OFF',

  // Experiments page
  'experiments.recording': 'Recording',
  'experiments.paused': 'Paused',
  'experiments.auto': 'Auto',
  'experiments.hide': 'Hide',
  'experiments.show': 'Show',
  'experiments.controlChars': 'Control Chars',
  'experiments.hex': 'Hex',
  'experiments.named': 'Named',
  'experiments.eventLog': 'Event Log',
  'experiments.noEvents': 'No events yet...',
  'experiments.testDesc': 'Test description:',
  'experiments.eventDesc1': 'event: contains data and inputType',
  'experiments.eventDesc2':
    'event: contains key, code, which and modifier keys',
  'experiments.eventDesc3':
    'Note: Some browser combinations (like Ctrl+C) may not trigger input events',
  // Xterm test
  'experiments.xtermTitle': 'Xterm.js Input Test',
  'experiments.xtermDesc':
    'Monitor onData / onKey events from xterm.js Terminal instance and underlying textarea events',
  'experiments.xtermTerminal': 'Xterm Terminal',
  'experiments.xtermHint':
    'Focus the terminal and type to see events. Try special keys (arrows, Ctrl+C, etc.)',
  'experiments.eventExplanation': 'Event explanation:',
  'experiments.onDataDesc':
    'Main data event from xterm, contains all data sent to PTY including characters, control codes (\\r, \\n, \\t, etc.) and escape sequences.',
  'experiments.onKeyDesc':
    'Triggered on each keypress, contains key, code, which and modifier key information.',
  'experiments.textareaEventDesc':
    'Native events from the underlying textarea. Note: textarea_input may not trigger on some browsers/platforms.',
  // Textarea test
  'experiments.textareaTitle': 'Textarea Input Test',
  'experiments.textareaDesc':
    'Monitor input / keydown / keyup events from textarea element',
  'experiments.textarea': 'Textarea',
  'experiments.textareaPlaceholder': 'Type something here...',
  'experiments.textareaHint':
    'Focus this textarea and type to see events captured below.',
  'experiments.copy': 'Copy',
  'experiments.copyEvents': 'Copy event log to clipboard',
  'experiments.copied': 'Copied!',
  'experiments.copyFailed': 'Failed to copy to clipboard',
  // Terminal agent auth readable errors
  'terminal.errorTitle': 'Terminal error',
  'terminal.agentNoPipe':
    'No SSH agent pipe found. Start Windows OpenSSH Authentication Agent service, or set SSH_AUTH_SOCK to a valid pipe.',
  'terminal.agentSockInvalid':
    'The pipe path in SSH_AUTH_SOCK does not exist. Please verify your configuration.',
  'terminal.agentPermissionDenied':
    'Permission denied when opening SSH agent pipe. Ensure the app and agent run with matching privilege level.',
  'terminal.agentNoIdentities': 'SSH agent has no available identities.',
  'terminal.agentRejected':
    'All identities from SSH agent were rejected by the server.',
  'terminal.agentReadFailed':
    'Failed to read identities from SSH agent. Please check agent status.',
  'terminal.agentNotRunning':
    'Windows OpenSSH Authentication Agent service is not running. Start it via services.msc, or install OpenSSH.',
  'terminal.agentPageantNotRunning':
    'Pageant (PuTTY SSH agent) does not appear to be running. Start Pageant or add keys to Windows OpenSSH Agent instead.',
  'terminal.agentAccessDenied':
    'Access denied to SSH agent pipe. The agent may be running under a different user session. Try running the app with the same user account.',
  'terminal.agentNotAvailable':
    'SSH agent pipe is not available. The agent service may have stopped.',
  'terminal.agentAuthFailed':
    'SSH agent authentication failed. Check agent logs for details.',
  'terminal.agentUnixNoSocket':
    'SSH_AUTH_SOCK socket not found on Unix. Start ssh-agent or set SSH_AUTH_SOCK.',
  'terminal.connectionFailed':
    'Connection failed. Check host address and network.',
  'terminal.authFailed':
    'Authentication failed. Check username and credentials.',
  'terminal.hostKeyFailed': 'Host key verification failed. Check known_hosts.',
  'terminal.sessionTimeout':
    'Session timed out. The connection may have been closed.',
}
