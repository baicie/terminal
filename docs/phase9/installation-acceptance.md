# 安装验收（P9.0）

## 1. 三个平台的验收方式

全部通过真实 runner 执行，**不接受模拟安装结果**。

共同做法：隔离用户数据目录 → 首次启动 → 通过真实应用路径写入受控测试数据（无凭证）→ 覆盖安装 →
再次启动 → **逐字段读回**。

**关键设计：内容相关的读证明。** 预置 app_settings.terminalThemeLightMigrated=false，
应用启动时 hydrateFromDatabase 会读这一行并把值写回 true。于是断言该值变成 true ——
**应用没启动或没读到数据库就必然失败**。哈希只作辅助证据并明确标注 supplementary。

## 2. 各平台结果

### Windows（NSIS）

- 静默安装 /S → 注册表卸载项必须找到 → 首次启动 5 秒存活 → 数据目录创建
- 覆盖安装保留安装目录与二进制 → 再启动存活 → **数据保留验证通过**
- 静默卸载删除安装目录，按 deleteAppDataOnUninstall 配置断言用户数据留存
- **PowerShell 解析门禁**：真实验证之前先用 Parser::ParseFile 校验脚本

### macOS（DMG）

- DMG 挂载 → .app 复制 → **CFBundleIdentifier 必须 = com.baicie.termius**（身份未被改变）
- 二进制启动存活 → 覆盖安装保留 bundle 与身份 → 再启动存活 → 卸载
- **数据保留改为验证数据库内容**：轮询 terminal.db、校验 SQLite 文件头、记录 sha256，
  覆盖安装后必须**逐字节一致**

### Linux（deb + AppImage）

- deb 存在且 >1MiB、dpkg-deb -f 打印元数据、ldd 不得 not found
- 真实 dpkg 安装（sudo apt-get install ./pkg.deb）；失败则 SKIPPED 并打印原因，改用 dpkg-deb -x
- .desktop 断言：Exec=terminal 是**正常写法**（裸命令名经 PATH 解析到 /usr/bin/terminal）
- AppImage 直跑，失败才在同一检查内重试 --appimage-extract-and-run
- **74 passed / 0 failed**

## 3. 本轮修掉的三个 CI 阻塞

| 问题 | 真因 |
| --- | --- |
| Windows 脚本无法解析 | 单引号字符串里的撇号（app-s 的缩写形式）提前终止字符串；括号配平显示完全平衡，**人工复核看不出** |
| Linux 作业被打红 | 74 passed / 0 failed 全过后，EXIT trap 的 rm -rf 与仍在写入的 AppImage 进程竞态 |
| macOS/Linux schema 未完成 | pragma 绑定参数 + 方法解绑（见 startup-and-migration.md） |

## 4. NOT_RUN（不可自动化，如实标注）

| 项 | 原因 |
| --- | --- |
| Gatekeeper「无法验证开发者」弹窗 | 阻塞式 GUI 安全对话框，需人工点击 |
| Developer ID 签名与公证 | CI 无签名身份 |
| SmartScreen / Mark-of-the-Web | 需人工判断 |
| Authenticode 签名 | CI 无证书 |
| 真实 UI 读回（打开列表看到记录） | runner 无 GUI 自动化栈；替代证据 = 应用启动写回 + 逐字段 SQL |
| Vault 加密往返 | 需交互式主密码；加密正确性由 rust vault_tests 覆盖 |
| Linux 桌面会话菜单集成 | runner 无桌面会话 |
| Windows 跨版本升级 vN 到 vN+1 | CI 只构建一个版本 |
| 物理键盘 / IME | 需人工键入 |

**这些必须单独列出，不能计入「安装验收通过」。**