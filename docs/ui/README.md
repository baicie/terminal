# UI 文档索引

> 本目录存放应用界面与功能的规格说明，采用结构化描述便于 AI 阅读与代码生成时引用。

## 文档用途

- **AI 阅读**：章节清晰、关键词统一、避免歧义，便于检索与理解。
- **实现对照**：开发时可将文档与现有组件（`src/view/`、`src/components/`）对照实现或还原 UI。
- **设计还原**：参考截图/设计稿时，以本目录描述为准进行布局与交互实现。

## 文档列表

| 文档                                                         | 内容                                                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| [00-design-system.md](./00-design-system.md)                 | 设计系统：主题、颜色、字体、图标、间距                                                    |
| [01-layout-and-navigation.md](./01-layout-and-navigation.md) | 全局布局：顶栏、标签页、左侧导航、主内容区                                                |
| [02-views.md](./02-views.md)                                 | 各功能视图：Hosts、Terminal、SFTP、Logs、Port Forwarding、Known Hosts、Keychain、Snippets |

## 阅读顺序建议

1. 先读 **00-design-system** 与 **01-layout-and-navigation**，建立整体布局与风格。
2. 再按需查阅 **02-views** 中对应视图（如实现 Hosts 时只看 Hosts 小节）。

## 关键词速查

- **布局**: 顶栏 / 侧栏 / 主内容区 / 双栏 / 三栏
- **导航**: Hosts / Keychain / Port Forwarding / Snippets / Known Hosts / Logs
- **会话**: 标签页 / Vaults / SFTP / 终端会话
- **主题**: 深色模式 / Dark / 背景色 / 强调色
