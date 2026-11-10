# Phase 10.3 — Tabby 替代验收与能力矩阵

- 基线：`main = e843e39`
- 本轮范围：Phase 10.2 的 A / B 两组工作包已实现；C / D / E 组的真机项未执行
- **本文不是「可以替代 Tabby」的宣告。** 它是一份如实的能力对照，把每一条的
  依据写清楚，并列出仍然空着的那部分。

## 0. 判定

```
HOST_EDIT_UI_WIRED=PASS
OPENSSH_IMPORT_UI_READY=PASS
OPENSSH_IDENTITYFILE_REAL_CONNECT=NOT_RUN
OPENSSH_PROXYJUMP_REAL_CONNECT=NOT_RUN
VAULT_REAL_E2E=NOT_RUN
SSH_VAULT_REAL_E2E=NOT_RUN
JUMP_HOST_VAULT_REAL_E2E=NOT_RUN
SFTP_REAL_E2E=NOT_RUN
SHELL_KEYBOARD_COMPATIBILITY=NOT_RUN
GUI_IME=NOT_RUN
TERMINAL_SESSION_LIFECYCLE=NOT_RUN
WORKSPACE_RESTORE=NOT_RUN
CROSS_PLATFORM_RUNTIME_QA=NOT_RUN
SECURITY_RELEASE_BLOCKERS=2 上游 advisory + 签名/公证 BLOCKED_EXTERNAL
DAILY_DRIVER_7DAY_SCORECARD=NOT_RUN

DAILY_DRIVER_READY=NO
TABBY_REPLACEMENT_READY=NO
READY_FOR_PUBLIC_RELEASE=NO
```

**为什么 `HOST_EDIT_UI_WIRED=PASS` 而其余是 NOT_RUN**：前者是代码可达性，由组件
测试驱动真实交互链路证明；后者全部需要真实 GUI、真实 sshd 或真实硬件，CI 与
jsdom 无法替代。这条界线在 Phase 10 定下，本轮不放宽。

## 1. Phase 10.2 本轮实际完成的部分

| 工作包 | 内容 | 依据 |
| --- | --- | --- |
| A1 主机编辑入口 | 卡片菜单 / 移动端 Sheet / 三种卡片变体都能编辑；对话框带已有值；保存走 `updateHost` | 10 项组件测试（先红后绿 6 failed → 6 passed，4 passed） |
| A2 Vault 首次使用 | 保存被 Vault 拒绝时，对话框就地提供创建/解锁；成功后自动重试同一 payload；`unusable` 不给假按钮 | 5 项测试（先红后绿 4 failed → 5 passed） |
| B1 导入向导 | 选文件 / 粘贴 → 预览（新建/重复/无法导入/警告）→ 勾选 → 导入 → 逐项结果 | 17 项测试（服务层 10 + 组件 7） |
| B2 IdentityFile | 路径进独立列（含 schema 迁移），不再冒充 `privateKey`；连接层明确拒绝未导入的路径 | 4 项测试 + 更新 1 条把缺陷断言成正确行为的旧测试 |
| B3 ProxyJump | 两遍解析别名 → 候选 id；解析不到标 invalid 并写 warning | 3 项测试 |
| 安全台账 | 四态分离、两条不可修 advisory、并发判定 | `13-phase10-2-security-ledger.md` |

**A1 的前提说实话**：Phase 10.1.1 认定该缺陷「函数级真实、生产不可达」，因为两处
`HostDialog` 入口都没传 `host`。本轮把它接上了 —— 现在可达了。这不是修一个正在
伤害用户的 bug，而是补上一个「一旦有人用就立刻丢数据」的缺口。

## 2. Tabby 核心能力差异矩阵

判定口径：**PASS** = 真实执行且有证据；**PARTIAL** = 部分成立；**FAIL** = 已复现
失败；**NOT_RUN** = 没有执行。

| 能力 | Terminal | 依据 | Tabby 对等 |
| --- | --- | --- | --- |
| 本地 shell 终端 | ✅ 实现 | xterm.js + portable-pty；索引路由指向终端常驻层 | 是 |
| 多标签 | ✅ 实现 | Zustand 管理，不依赖 URL | 是 |
| 分屏 | ✅ 实现 | `components/split-pane` | 是 |
| SSH 密码认证 | ✅ 实现 | 实机矩阵 debug 11/11、release 8/8（Phase 9.x） | 是 |
| SSH 私钥认证 | ✅ 实现 | 同上，key 模式含重连 | 是 |
| SSH Agent | ✅ 实现（Unix）；❓ Windows 未实机 | Unix `SSH_AUTH_SOCK`；Windows OpenSSH named pipe + Pageant 回退**已实现但无实机证据** | 是 |
| SSH 证书 | ✅ 实现 | 矩阵覆盖 cert 模式 | 是 |
| Jump Host | ✅ 实现 | 双端凭据；`-R` 远端转发在 9.8-C2 真实 sshd 验证 | 是 |
| 端口转发 -L/-R/SOCKS | ✅ 实现 | `port_forward.rs`；9.8-C2 真实 sshd | 是 |
| SFTP | ✅ 实现 | staged upload + 原子替换（9.8-A，真实 OpenSSH sftp-server） | 是 |
| 主机搜索 | ✅ PASS | 1/20/21/100/1000 矩阵，第 1000 台可命中 | 是（Tabby 有 profile 搜索） |
| 主机编辑 | ✅ **本轮接线** | 10 项组件测试 | 是 |
| Quick Connect | ✅ 解析层 PASS | 36 项语法矩阵；UI 键入未做真实验证 | Tabby 有 quick connect |
| 凭据存储 | ✅ 实现 | Vault（Argon2id + AES-GCM），秘密列恒 NULL | Tabby 有 vault |
| OpenSSH config 导入 | ✅ **本轮接 UI** | 解析 24 + 计划 18 + 向导 17 项 | Tabby 也读 `~/.ssh/config` |
| Tabby 配置导入 | ❌ **NOT_RUN** | 无稳定公开格式样本，按规范不猜 | — |
| 插件系统 | ❌ 不做 | Phase 10 PRD 明确排除 | Tabby 有 |
| Telnet / Zmodem / X11 | ❌ 不做 | 同上，未确认为日用阻断 | Tabby 部分有 |
| Quake mode | ❌ 不做 | 同上 | Tabby 有 |
| 同步 / 云 | ⚠️ PARTIAL | Team Sync 服务端存在，跨版本兼容性是 RC 阻塞项（Phase 9.7 WP3） | Tabby 有 |

**结论**：日常终端的**核心闭环**（本地 shell、多标签分屏、SSH 各认证方式、Jump、
端口转发、SFTP、主机管理、OpenSSH 迁移）在代码层面齐备。差异集中在插件与
外围特性，以及——更重要地——**真机验收的空白**。

## 3. 必须承认的空白

以下每一条都不是「大概能用」，而是**没有执行**：

| 项 | 为什么没做 |
| --- | --- |
| Vault 真实生命周期（创建/解锁/改密/重启持久化） | 需真实 GUI 交互；本轮只做服务层与 disposable 演练 |
| 用 Vault 中的密码/私钥真实登录 sshd | 需真实 sshd + 真实 Vault 会话 |
| Jump Host 双端凭据的真实登录 | 同上，且需两端凭据 |
| `IdentityFile` 真实连接 | 需临时私钥文件 + 测试 sshd，本机无 |
| `ProxyJump` 真实连接 | 同上 |
| SFTP 在本轮改动后重跑 | 未重跑 |
| 中文输入法、物理键盘、Vim/less/readline | 无辅助功能权限，无法驱动真实 IME |
| 标签切换/分屏/唤醒/Workspace 恢复 | 需真实 GUI |
| macOS / Windows / Linux 真机 | 无环境 |
| 7 天日用 Scorecard | 需要真实连续使用 7 天 |

## 4. 7 天 Scorecard 模板（未填写）

**没有实际填写之前，`TABBY_REPLACEMENT_READY` 不得为 PASS。**

```
日期 | 使用时长 | SSH 次数 | SFTP 次数 | 阻断次数 | 阻断内容 | 回退 Tabby | 原因
-----|---------|---------|----------|---------|---------|-----------|-----
D1   |         |         |          |         |         |           |
D2   |         |         |          |         |         |           |
D3   |         |         |          |         |         |           |
D4   |         |         |          |         |         |           |
D5   |         |         |          |         |         |           |
D6   |         |         |          |         |         |           |
D7   |         |         |          |         |         |           |
```

通过条件（全部满足）：

- 0 个未解决 P0
- 0 个阻断日用的 P1
- 常用 SSH 与 SFTP 流程完整
- 本地 shell 与多会话稳定
- 已保存数据重启后正确
- **不因 Terminal 功能缺失而必须打开 Tabby**

## 5. 人工验收步骤（可执行）

### 5.1 主机编辑（本轮新增）

1. Hosts 页 → 任一主机卡片右上角「⋯」→ Edit；
2. 对话框应显示该主机的现有地址、端口、用户、认证方式；
3. 改 hostname 后保存；
4. 立即连接，确认用的是新地址；
5. **重启应用**，确认改动仍在；
6. 再打开一次，只改收藏状态，确认凭据仍在（不要求重输密码）。

### 5.2 Vault 首次使用（本轮新增）

1. 新装环境（无 Vault）→ 新建主机并填密码 → 保存；
2. 应出现「需要先创建 Vault」面板，且密码字段仍保留已输入内容；
3. 在该面板输入主密码创建 → 保存应自动继续；
4. 若中途取消，表单内容不得丢失。

### 5.3 OpenSSH 导入（本轮新增）

1. Hosts 页 → 下拉「从文件导入」；
2. 选 `~/.ssh/config`；
3. 预览应列出可新建 / 已存在 / 无法导入三类；
4. 已存在项**默认不勾选**；
5. 确认导入 → 逐项结果；
6. 再导入一次同一文件 → 应报告 0 台新建。

### 5.4 仍需真机的项目

见 §3。每一条都需要：真实 sshd（可用 Docker）、真实 IME、或真实第二平台。

## 6. 本轮不声称的东西

- 不声称「可以替代 Tabby」——7 天数据为空。
- 不声称「凭据系统已验证」——真实 GUI 的 Vault 生命周期未跑。
- 不声称「导入能连上」——`IdentityFile` / `ProxyJump` 的真实连接未验证；
  代码路径已修正且被测试锁定，但「测试通过」与「SSH 握手成功」是两件事。
- 不声称「三平台可用」——只有 CI 构建成功，那不是运行验收。
