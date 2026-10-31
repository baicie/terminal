export default {
  // Port Forward
  'portForward.portForwards': 'Port Forwards',
  'portForward.addPortForward': 'Add Port Forward',
  'portForward.type': 'Type',
  'portForward.local': 'Local',
  'portForward.remote': 'Remote',
  'portForward.socksProxy': 'SOCKS Proxy',
  'portForward.addForward': 'Add Forward',
  'portForward.localForward': 'Local Port Forward (-L)',
  'portForward.remoteForward': 'Remote Port Forward (-R)',
  'portForward.dynamicForward': 'Dynamic Port Forward (-D)',
  'portForward.name': 'Name',
  'portForward.myForward': 'My Forward',
  'portForward.stop': 'Stop',
  'portForward.start': 'Start',
  'portForward.configured': '{{count}} forward(s) configured',
  'portForward.noConfigured': 'No port forwards configured',
  'portForward.socksDesc': 'Creates a SOCKS proxy at {{host}}:{{port}}',
  'portForward.active': 'Active',
  'portForward.stopped': 'Stopped',
  'portForward.dynamic': 'Dynamic',
  'portForward.via': 'via {{host}}',

  // Port Forward view
  'portForwardView.title': 'Port Forwarding',
  'portForwardView.searchForwards': 'Search forwards...',
  'portForwardView.newForward': 'New Forward',
  'portForwardView.addForward': 'Add Forward',
  'portForwardView.noForwards': 'No port forwards configured',
  'portForwardView.forwardsDesc':
    'Set up port forwarding to access databases, web apps, and other services',
  'portForwardView.remoteRequired': 'Remote host and port are required',
  'portForwardView.invalidLocalPort': 'Invalid local port number',
  'portForwardView.started': 'Port forward started on {{address}}',
  'portForwardView.stopSuccess': 'Port forward stopped',
  'portForwardView.startFailed': 'Failed to start port forward: {{message}}',
  'portForwardView.stopFailed': 'Failed to stop port forward: {{message}}',
  'portForwardView.removed': 'Port forward removed',
  'portForwardView.loadFailed': 'Failed to load port forwards: {{message}}',
  'portForwardView.stopTitle': 'Stop Port Forward',
  'portForwardView.stopConfirm':
    'Stop "{{name}}"? Every connection using this tunnel is closed immediately.',
  'portForwardView.savedNotStarted':
    'Rule saved, but no SSH session is connected, so the tunnel was not started.',
  'portForwardView.noSession':
    'No SSH session is connected, so the tunnel cannot start.',
  'portForwardView.startAction': 'Start {{name}}',
  'portForwardView.stopAction': 'Stop {{name}}',
  'portForwardView.deleteAction': 'Delete {{name}}',
  'portForwardView.deleteTitle': 'Delete Port Forward',
  'portForwardView.deleteConfirm':
    'Delete "{{name}}"? The rule is removed permanently. A running tunnel is not stopped, so stop it first.',
}
