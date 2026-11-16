# Terminal Next reference assets

这些文件是用户提供的视觉参考图，尺寸均为 1586×992。它们只用于比较信息层级、密度、组件关系和视觉语言，不是当前应用截图，也不证明图片里的 Host、在线状态、指标、凭据或 AI 回答真实存在。

| 文件 | 对应规格 |
| --- | --- |
| [`01_Focused_Terminal_Workspace.png`](desktop/01_Focused_Terminal_Workspace.png) | `03` Focus Terminal / `04` Terminal Workspace |
| [`02_Connections_and_Host_Management.png`](desktop/02_Connections_and_Host_Management.png) | `03` Explorer / Hosts 管理 |
| [`03_SSH_Connection_and_Credential_Vault.png`](desktop/03_SSH_Connection_and_Credential_Vault.png) | `03` New SSH Connection / `05` UX-2 |
| [`04_Split_Terminal_Workspace.png`](desktop/04_Split_Terminal_Workspace.png) | `03` Split Workspace / `04` UX-1 |
| [`05_SFTP_File_Manager.png`](desktop/05_SFTP_File_Manager.png) | `03` SFTP Full/Dock / `04` UX-1 |
| [`06_Logs_and_Output_Explorer.png`](desktop/06_Logs_and_Output_Explorer.png) | `03` Logs & Output |
| [`07_Operations_Dashboard.png`](desktop/07_Operations_Dashboard.png) | `03` Server Inspector；不引入监控大屏 |
| [`08_AI_Assistant_Workbench.png`](desktop/08_AI_Assistant_Workbench.png) | `03` AI Dock / `07` UX-4 |
| [`09_Settings_and_Preferences.png`](desktop/09_Settings_and_Preferences.png) | `03` Settings |
| [`10_Command_Palette_and_Global_Search.png`](desktop/10_Command_Palette_and_Global_Search.png) | `03` Command Palette |

v2.0 合订版还声称有 4 张 Windows 参考图，但在本轮可访问的仓库和外部输入目录中未找到它们。Windows 的真实验收必须使用 `03-ui-ux-blueprint.md` 的平台矩阵；收到原图后再增加资产，不使用其他图片代替。

## 反面参考与验收边界

以下内容即使出现在参考图中，也不能从图片推导出来：

- 图中的 Host、在线状态、Recent 顺序、传输进度、指标数字和 AI 回答都不是 fixture 或产品证据。
- `04_Split_Terminal_Workspace.png` 的四格视觉只能说明层级关系；当前 Core 每个 SplitGroup 仍限制为双 Pane，2×2 需要独立实现和验收。
- 图中 SFTP 的列表或进度不能证明 UI→Tauri IPC→Rust→sshd 的真实链路、远端 SHA 或关闭 Dock 后的字节完整性。
- 图中的 Vault/Keychain 表单不能证明系统 Provider、签名身份、升级/回退或真实密钥存储可用。
- 图中的 Operations Dashboard 不能把 Terminal Next 变成常驻监控平台；Inspector 仍是用户触发的短时只读 probe。
- 图片不能替代真实 Tauri 窗口、DPI、Window Controls、焦点、物理键盘和 IME 验收。
