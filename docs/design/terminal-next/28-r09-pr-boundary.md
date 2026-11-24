# R09 — 提交复审与 PR 边界

基线 `main = e2a2e58`，分支 `fix/tn-sftp-gui-closure`，**20 个提交，57 个文件，
+9707 / −140**。

---

## 一、边界决定：**一个集成 PR，不拆**

R09 给了两个选项：A（WDIO 脚手架 + 证据脱敏 + T09/T10/T11）与 B（SFTP 完整性竞态 +
T13/T14/T15/T16），或一个集成 PR 带模块化章节。

**选集成 PR。** 理由是可验证的，不是偏好：

### 拆分会造成的具体问题

1. **`e2e/gui/artifacts/` 是跨主题共享的**。`d3a2f46`（重采全部 GUI 证据）与
   `bf01919`（R04 新增证据）同时包含 A 和 B 两个主题的 JSON 与 PNG。拆成两个 PR 时，
   这些文件只能进其中一个，另一个的 spec 就没有对应证据。

2. **`scripts/verify-install/sftp-command-e2e.mjs` 同时被两个主题改动**：
   `86f8ba4`（整形代理接线，主题 B）与 `225e7be`/`64cdb0e`（时限与 fixture 超时，
   R02/R03）。两个 PR 都要改同一个文件，会产生一个必然冲突的 hunk。

3. **R02 的进程泄漏修复（`f45de4d`）是 R03 时限修复（`225e7be`）的前提**。
   `stopProcess` 的 `close`/`exit` 语义错误必须先修，否则「有界清理」会返回
   `graceful` 而进程仍在 —— 那正是 R03 要消掉的最坏形态。分开就是让第二个 PR
   依赖第一个的未合并代码。

4. **证据的源码指纹是整棵树算的**。任何一次证据重采都覆盖全部分支内容，拆分后
   两个 PR 各自声称的证据会指向不同 SHA，验收矩阵无法对齐。

### 集成 PR 的代价与补救

代价是一个 PR 较大（57 文件）。补救是 PR 描述按模块分节，让评审可以分段读：

| 节 | 内容 | 提交 |
| --- | --- | --- |
| 1. SFTP 目标身份与写入期竞态 | R01 | `3f75b51` `b2816bb` |
| 2. 测试基础设施的进程与时限 | R02/R03 | `f45de4d` `225e7be` `64cdb0e` |
| 3. GUI 焦点钩子守卫 | R04 | `bf01919` |
| 4. 复审记录 | R05–R08 | `ef59ad2` `da1ab8a` `40cb94f` |
| 5. 此前的 T09–T16 工作 | 早于本轮 | `1459902` … `d5ac89d` |

---

## 二、临时产物与个人路径检查

| 检查 | 结果 |
| --- | --- |
| `.log` / `.tmp` / `debug-` / `.orig` / `.bak` / `.DS_Store` | **无** |
| 个人绝对路径（源码与测试） | **已清理**，见 §三 |
| 个人绝对路径（文档示例） | **已泛化** |
| `.claude/worktrees/` 内容 | 未入库（在 `.gitignore`） |

## 三、本轮清掉的三处个人标识

| 位置 | 原文 | 现在 |
| --- | --- | --- |
| `e2e/gui/fixtures/evidence.test.mjs` 的提示符夹具 | `liuzhiwei@liuzhiweideMacBook-Pro` | `runner@runners-MacBook-Pro` |
| 同文件的 home 路径夹具 | `/Users/liuzhiwei/Library/...` | `/Users/runner/Library/...` |
| R06 审计文档的三个示例 | 真实用户名 | `<user>` |

**为什么要改**：一个为隐私而写的测试，不该把隐私写进自己的源码。断言强度不变 ——
它检查的是「这一形态被脱敏」，不是「某个特定名字被脱敏」。20/20 仍通过。

一处保留：R06 文档里的
`grep -n "redact\|liuzhiwei\|privacy" scripts/check-verification-evidence.mjs`。
那是**说明门禁缺什么的命令**，脱敏掉就看不出它在找什么。

---

## 四、提交信息质量抽查

抽查三条，确认它们记录的是「为什么」而不只是「改了什么」：

- `f45de4d` — 标题就写明根因（`close` 被当成了 `exit`），正文给出 5 ms 假 graceful 的实测；
- `225e7be` — 记录 77 分钟挂起、1754 次采样同栈、0 个 TCP socket 三个事实；
- `64cdb0e` — 区分「产品路径有 timeout_at + TcpShutdownGuard」与「测试夹具两样都没有」。

没有纯 WIP / fixup / 无信息量的提交。
