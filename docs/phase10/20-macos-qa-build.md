# macOS QA 构建记录

- 源码：`main = 13e9d96`（功能合并 `e234091`，含 Phase 10.4 / 10.4.1 全部修复）
- 构建时间：2026-11-11 12:35（CST）
- 构建主机：Apple M1（arm64），macOS Darwin 24.6.0

## 产物

| 项 | 值 |
| --- | --- |
| 路径 | `~/terminal-qa-builds/Terminal-qa-13e9d96-aarch64.dmg` |
| 大小 | 13,789,535 bytes（13.1 MB） |
| SHA256 | `545f12115b1406b75d6220090749b75bbc1249643388cb29c65ebdfdc47cff27` |
| 架构 | `arm64`（Mach-O 64-bit executable arm64） |
| 签名 | `adhoc`，`TeamIdentifier=not set` |

同名 `.app` 在构建 worktree 内：
`~/terminal-qa-13e9d96/src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Termius.app`

校验命令：

```bash
cd ~/terminal-qa-builds && shasum -a 256 -c SHA256SUMS.txt
```

## 工具链

| 项 | 版本 | 与 `rust-toolchain.toml` 一致 |
| --- | --- | --- |
| rustc / cargo | 1.96.0 (ac68faa20 2026-05-25) | ✅ channel = "1.96.0" |
| node | v22.12.0 | — |
| pnpm | 10.34.3 | — |
| 目标三元组 | `aarch64-apple-darwin` | 按本机架构选择 |

构建参数：`pnpm tauri build --target aarch64-apple-darwin`（release profile，
`pnpm install --frozen-lockfile` 后执行）。

## 构建隔离

在独立 git worktree `~/terminal-qa-13e9d96`（detached HEAD `13e9d96`）中进行，
不触碰主工作区的 `src-tauri/target` —— 那里是证据锚定的产物。未修改
`tauri.conf.json`、未改更新源、未创建 Tag、未创建 Release。

## 与 v0.0.1-dev.2 发布包的区别

**两者不是同一个包，尽管版本号相同。**

| | v0.0.1-dev.2（Phase 9.5 发布） | 本次 QA 构建 |
| --- | --- | --- |
| 资源名 | `Terminal_0.0.1-dev.2_macos-aarch64.dmg` | `Termius_0.0.1-dev.2_aarch64.dmg` |
| SHA256 | `2c9a0ca3…` | `545f1211…` |
| 大小 | 12,035,266 | 13,789,535 |
| 源码 | Phase 9.5 时期 | `13e9d96`（含 Phase 10.4.1） |

版本号相同是因为 `tauri.conf.json` 里 `version` 仍是 `0.0.1-dev.2`；资源名不同
是因为 `productName` 后来从 `Terminal` 改成了 `Termius`。**文件名已带源码 SHA，
避免混淆。**

## 签名与公证缺失的影响

这个包是 **adhoc 签名、未经 Developer ID 签名、未公证**。具体后果：

1. **首次打开会被 Gatekeeper 拦截**。需要右键 → 打开，或在「系统设置 → 隐私与
   安全性」中点「仍要打开」。仅首次，之后正常。
2. **从 DMG 拖到 /Applications 后同样适用**。没有 quarantine 属性的本地构建
   通常不受影响，但用户从网络传输过来的副本会带 quarantine。
3. **不能自动更新**。更新链要求 minisign 签名与 `latest.json`，这个包两者都没有；
   它也不会修改线上更新源。
4. **密钥串/钥匙串访问**不会分配稳定的代码签名身份，因此不同构建之间可能被视为
   不同的应用。对 QA 用途无影响。
5. **不适用于分发给他人**。本文档只把包交给构建机的所有者本人测试。

以上均不影响功能验证 —— 它影响的是分发与信任链。

## 本次在真实应用上验证到的（可复现）

用隔离 `HOME` 启动该构建的真实二进制（`Termius.app/Contents/MacOS/terminal`），
观察结果：

| 项 | 结果 | 证据 |
| --- | --- | --- |
| 应用真实启动 | ✅ | 进程存活，窗口出现在 System Events 的可见进程列表 |
| 前端 bootstrap 完整 | ✅ | 日志链 `db bootstrap → terminal-open → terminal-mounted → session-create-requested → session-created` |
| 数据库 schema | ✅ | `hosts` **24 列**，含 `credential_ref` / `identity_file_path` / `agent_forwarding` / `shell_integration` |
| 本地 PTY 会话 | ✅ | `session-created = local-95c3508d-…` |
| 重启后 Workspace 恢复 | ✅ | `layout=known`、`restore-layout-committed`、`active-tab-selected = local-1794371801690`、`workspaceId=250096d0-…` |
| 启动无崩溃/错误日志 | ✅ | stderr 为空，stdout 中 `panic`/`ERROR` 计数为 0 |
| 真实用户数据未被触碰 | ✅ | `terminal.db` SHA256 `514b28c0…` 与 mtime `Nov 8 11:50` 前后一致 |

**这一层已到自动化的边界。** 再往上需要驱动窗口内的点击与键入。

## 未能验证的，以及为什么

本机 `AXIsProcessTrusted: false`，AppleScript 访问返回
`osascript 不允许辅助访问 (-1728)`。因此**无法**：

- 点击任何按钮、菜单、对话框
- 在终端窗口内键入（含中文输入法）
- 读取窗口内的文本内容

这意味着以下项目全部保持 `NOT_RUN`，不会因为上面那些自动化结果而改判：

```
VAULT_REAL_GUI_FLOW          = NOT_RUN
SSH_PASSWORD_REAL_GUI        = NOT_RUN
SSH_KEY_REAL_GUI             = NOT_RUN
SSH_AGENT_REAL_GUI           = NOT_RUN
OPENSSH_IDENTITYFILE_REAL    = NOT_RUN
PROXYJUMP_REAL_GUI           = NOT_RUN
SFTP_REAL_GUI                = NOT_RUN
GUI_IME                      = NOT_RUN
MULTI_TAB_SPLIT_REAL_GUI     = NOT_RUN
CLEAR_CREDENTIAL_FAILURE_UI  = NOT_RUN
```

## 测试环境（已建立，可复用）

`~/terminal-qa-env/`，权限 700：

| 路径 | 内容 | 是否含秘密 |
| --- | --- | --- |
| `ssh/id_ed25519` | 一次性测试私钥（`SHA256:Qz2mvFN…`） | 是，仅本地 |
| `sshd/` | 专用 sshd：`127.0.0.1:63830`，密钥登录 + `Subsystem sftp` | 主机密钥 |
| `jump/target/sshd/` | Target 主机 `127.0.0.1:63930` | fixture 生成 |
| `jump/jump/sshd/` | Bastion `127.0.0.1:63932` | fixture 生成 |
| `sftp/remote-root/` | SFTP 测试目录（`remote.txt`、`overwrite-me.txt`） | 否 |
| `run1/` | 隔离 HOME，应用数据在其下的 `Library/Application Support/com.baicie.termius` | Vault 未创建 |
| `launch.sh` | 隔离启动脚本，**拒绝**在真实 HOME 上运行 | 否 |

**没有任何真实用户凭据进入这些目录。** 私钥只用于一次性 sshd，验收结束即可删除。

### 关于 ProxyJump fixture 的一个限制

仓库的 `scripts/terminal-smoke-sshd.mjs` 用强制命令（`command="..."` + `no-pty`）
实现 jump 角色，因此 `ssh -W` 经 Bastion 转发会被拒。这不是产品缺陷 —— fixture
是为**产品自己的 ProxyJump 协议**设计的。用 `ssh -W` 验证它只能得出「CLI 层不适用」
的结论，不能记成产品 ProxyJump 失败，也不能记成通过。
