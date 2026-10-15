export default {
  // 启动失败界面，在主应用 chunk 加载完成前显示。
  'startup.failure.title': '终端无法启动',
  'startup.failure.description': '应用在工作区就绪之前就已失败。',
  'startup.failure.details': '启动详情',
  'startup.failure.retry': '重试启动',
  'startup.failure.hint':
    '这通常由本地数据库不可用或被占用导致。重试会重新执行工作区恢复。如果持续失败，请重启应用或查看「日志」视图了解详情。',
  // 应用已启动但未能读取已保存的偏好设置时显示。
  'startup.settingsRestoreFailed':
    '未能加载已保存的设置，当前使用默认值。请查看「日志」视图了解详情。',
}
