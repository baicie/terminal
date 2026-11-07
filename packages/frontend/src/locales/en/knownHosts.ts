export default {
  // Known Hosts
  'knownHosts.title': 'Known Hosts',
  'knownHosts.searchHosts': 'Search known hosts...',
  'knownHosts.import': 'Import',
  'knownHosts.noKnownHosts': 'No known hosts',
  'knownHosts.importFromFile': 'Import hosts from your SSH known_hosts file',
  'knownHosts.clearAll': 'Clear All',
  'knownHosts.description':
    'Back up fingerprints in the app; SSH trust uses the OpenSSH .ssh/known_hosts file in your user home directory',
  'knownHosts.emptyDescription':
    'Import a backup copy; update your OpenSSH .ssh/known_hosts file separately to trust a host',
  'knownHosts.portLabel': 'Port {{port}}',
  'knownHosts.detailsDescription':
    'App backup only; this record does not control SSH trust.',
  'knownHosts.keyType': 'Key Type:',
  'knownHosts.port': 'Port:',
  'knownHosts.fingerprint': 'Fingerprint:',
  'knownHosts.added': 'Added: {{date}}',
  'knownHosts.deleteTitle': 'Delete Known Host',
  'knownHosts.deleteConfirm':
    'Delete the app backup for "{{hostname}}"? This does not remove trust from your OpenSSH .ssh/known_hosts file.',
  'knownHosts.clearAllTitle': 'Clear All Known Hosts',
  'knownHosts.clearAllConfirm':
    'Delete all {{count}} app backup records? This does not change your OpenSSH .ssh/known_hosts file.',
  'knownHosts.importTitle': 'Import Known Hosts',
  'knownHosts.importDescription':
    'This imports a backup copy into the app only. It does not update your OpenSSH .ssh/known_hosts file or change SSH trust. Supported format: OpenSSH known_hosts.',
  'knownHosts.importContentLabel': 'Known Hosts Content',
  'knownHosts.importPlaceholder': 'Paste known_hosts content here...',
  'knownHosts.invalidImport':
    'No valid SSH known hosts entries found. Format should be: hostname ssh-rsa KEY',
}
