export default {
  // Known Hosts
  'knownHosts.title': '已知主机',
  'knownHosts.searchHosts': '搜索已知主机...',
  'knownHosts.import': '导入',
  'knownHosts.noKnownHosts': '暂无已知主机',
  'knownHosts.importFromFile': '从 SSH known_hosts 文件导入主机',
  'knownHosts.clearAll': '全部清除',
  'knownHosts.description':
    '在应用内备份指纹；SSH 信任使用用户主目录中的 OpenSSH .ssh/known_hosts 文件',
  'knownHosts.emptyDescription':
    '导入备份副本；要信任主机，请另行更新 OpenSSH .ssh/known_hosts 文件',
  'knownHosts.portLabel': '端口 {{port}}',
  'knownHosts.detailsDescription': '仅为应用内备份；此记录不会影响 SSH 信任。',
  'knownHosts.keyType': '密钥类型：',
  'knownHosts.port': '端口：',
  'knownHosts.fingerprint': '指纹：',
  'knownHosts.added': '添加于 {{date}}',
  'knownHosts.deleteTitle': '删除已知主机',
  'knownHosts.deleteConfirm':
    '删除 "{{hostname}}" 的应用内备份？这不会从 OpenSSH .ssh/known_hosts 文件中移除信任。',
  'knownHosts.clearAllTitle': '清除所有已知主机',
  'knownHosts.clearAllConfirm':
    '删除全部 {{count}} 条应用内备份记录？这不会更改 OpenSSH .ssh/known_hosts 文件。',
  'knownHosts.importTitle': '导入已知主机',
  'knownHosts.importDescription':
    '这只会将备份副本导入应用，不会更新 OpenSSH .ssh/known_hosts 文件或更改 SSH 信任。支持格式：OpenSSH known_hosts。',
  'knownHosts.importContentLabel': '已知主机内容',
  'knownHosts.importPlaceholder': '在此粘贴 known_hosts 内容...',
  'knownHosts.invalidImport':
    '未找到有效的 SSH 已知主机条目。格式应为：hostname ssh-rsa KEY',
}
