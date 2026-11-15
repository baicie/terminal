# CI 测试矩阵

## 1. 每个 job 的验证契约

| job | 命令 | 证明什么 | 不证明什么 |
| --- | --- | --- | --- |
| `frontend` | lint / typecheck / vitest / build:budget | 前端源码正确、体积在预算内 | 真实 WebView 行为 |
| `frontend-audit` | `pnpm audit --prod` | 生产依赖无已知漏洞 | 开发依赖、供应链攻击 |
| `team-server` | prisma validate / typecheck / lint / test / build + 真实 PG | 服务端与并发正确 | 客户端跨版本兼容（见 §3）|
| `source-size` | source-size + evidence integrity + script tests | 文件规模、证据自洽、门禁脚本自身 | 产品行为 |
| `rust` | fmt / check / clippy / test / smoke-vault + **SFTP 命令级 E2E** | Rust 实现正确，含真实字节路径 | Tauri command 包装、GUI |
| `cargo-audit` | 三态裁定 | 无未记录 advisory | 零漏洞 |
| `docker` | Compose 校验 + 镜像构建 | 容器可构建 | 运行时行为 |
| `tauri` | 三平台打包 + 安装链 + 数据保留 | 可打包、安装不丢数据 | 真实交互 |
| `native-gui-e2e` | 真实 WebView E2E | 真实 UI（macOS 阻塞）| 无 |
| `required` | 聚合判定 | 上面每项的结论被正确汇总 | 各项自身内容 |

## 2. 分层的明确边界

任务书 §0.7 要求不混淆三层。本轮接入的 SFTP 测试属于**哪一层**，写在脚本头注释里：

| 层 | 谁测 | 证明 |
| --- | --- | --- |
| CLI SFTP | `sftp-roundtrip-live.e2e.test.ts` 驱动 `/usr/bin/sftp` | OpenSSH 能搬字节，**与本项目代码无关** |
| **Rust command 级** | `scripts/verify-install/sftp-command-e2e.mjs` → `sftp_command_e2e_tests` | `staged_upload` / `receive_download` 对真实服务器正确 |
| Tauri command | 无独立套件 | — |
| GUI | `native-gui-e2e.yml` | 真实 WebView 交互 |

**本轮接入的是第二层。** 它不证明 `#[tauri::command]` 包装层，也不证明前端传输队列。

## 3. 已知的未覆盖

| 项 | 状态 | 原因 |
| --- | --- | --- |
| Team Sync 跨版本 | 诊断（`continue-on-error`）| 已有的真实失败：服务端把毫秒游标判为超水位返回全量窗口，老客户端 `INSERT` 撞 UNIQUE。这是**已知产品缺陷**，不是测试问题；不删测试、不伪造通过 |
| Windows GUI E2E | informational | 终端在 Windows runner 上不挂载（AGENTS.md:567 记录的既有未验证项）|
| 真实发布流程 | NOT_RUN | 本轮未创建 tag/Release |
| Merge Queue | NOT_RUN | 未启用 |
| Fork PR 权限 | NOT_RUN | 本仓库无 fork |

## 4. 平台覆盖

| 平台 | 编译 | 打包 | 安装链 | Rust 测试 | SFTP 命令级 | GUI E2E |
| --- | --- | --- | --- | --- | --- | --- |
| macOS | ✅ | ✅ | ✅ | ✅ | ✅ 本地实测 5/5 | ✅ 阻塞 |
| Linux | ✅ | ✅ | ✅ | ✅（CI）| ✅（CI，`real sshd`）| ✅ informational |
| Windows | ✅ | ✅ | ✅ | ✅（CI）| ⚠️ 需 sshd 可选功能 | ❌ informational |

Windows 的 SFTP 命令级 E2E：脚本会探测 `System32\OpenSSH\sshd.exe`，缺失时给出
「Windows 的 OpenSSH 服务器是可选功能」而不是 `ENOENT`。但它跑在 `rust` job 上，
而该 job 是 `ubuntu-latest` —— **Windows 上从未执行过**。
