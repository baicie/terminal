# Phase 10.4 — 真实 Tauri 应用启动验收

- 基线：`main = 2813c26` + 本分支
- 执行环境：macOS（Darwin 24.6.0），本地构建的 release 二进制
- **这份记录不同于之前的单元/组件测试**：应用真的启动了，数据库真的建了

## 1. 方法与隔离

```
CARGO_TARGET_DIR=/tmp/terminal-wp4-build pnpm tauri build --no-bundle
HOME=<临时目录> <二进制>
```

`HOME` 隔离沿用 `scripts/verify-install-macos.sh` 的做法：应用用
`dirs::config_dir()` 解析数据目录，该函数遵循 `HOME`，所以数据库与 Vault 都被移到
临时目录，不触碰本机真实数据。

## 2. 结果

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 应用启动 | **PASS** | 日志 `tauri app starting up` |
| 首次运行无数据库 | **PASS** | `db recovery stage="database-recovery" state=Healthy reason="the database does not exist yet"` |
| 前端 bootstrap | **PASS** | `stage=frontend-boot detail=main.tsx evaluated` |
| 启动探测并发 | **PASS** | `bootstrap-gates` 五个探测各 56ms，无饥饿 |
| schema 初始化 | **PASS** | `core-schema-finished: 20 statement(s) applied` → `ready: connection cached` |
| **schema 列完整性** | **PASS** | `hosts` 表 **24 列**，含 `credential_ref` 与 `identity_file_path` |
| 进程锁 | **PASS** | `instance.lock` 与 `recovery.lock` 均在数据目录创建 |
| WAL 模式 | **PASS** | `terminal.db-wal`、`terminal.db-shm` 存在 |
| Vault 文件 | 未创建 | 符合预期：用户尚未创建 Vault |
| 数据目录 | 隔离 | 全部落在 `$HOME/Library/Application Support/com.baicie.termius/` |

## 3. 一次误判的更正

初次检查时我用 `PRAGMA table_info(hosts) | head -20` 看到 20 列，误以为缺
`credential_ref` 与 `identity_file_path`，并一度判断为 P0。完整读取后确认是
**24 列，两列都在** —— `head -20` 截断导致。

记录这一点是因为它正是本系列反复出现的模式：**不完整地读证据就下结论**。
区别在于这次是我自己的输出被截断，而不是测试断言不全。

## 4. 这意味着什么，不意味着什么

**意味着**：打包的二进制能启动，Rust 侧的恢复状态机、单实例锁、前端 bootstrap
链与 schema 初始化在真实进程中都工作。

**不意味着**：

- Vault 的真实创建/解锁/改密 —— 需要 GUI 交互，本轮未执行
- 用 Vault 中的凭据真实登录 sshd —— `SSH_VAULT_REAL_E2E` 保持 NOT_RUN
- 终端窗口的可见性、标签、分屏 —— 无屏幕录制权限，无法验证渲染
- 中文输入法、物理键盘 —— 无辅助功能权限

## 5. 判定

```
REAL_APP_LAUNCH=PASS（本机 macOS，隔离 HOME）
REAL_APP_SCHEMA_INIT=PASS
VAULT_REAL_E2E=NOT_RUN（需要 GUI 交互创建与解锁）
SSH_VAULT_REAL_E2E=NOT_RUN
GUI_IME=NOT_RUN
```

启动日志保留在 `/tmp/wp4-real-app-startup.log`；该路径是临时文件，不入库。
需要长期留证时应在 CI runner 上重跑并把日志作为 artifact，而不是把本机路径写进仓库。
