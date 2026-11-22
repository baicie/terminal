# SFTP 完整性与 Core Daily Driver RC 验收

> 本文记录 2026-11-22 这一轮 T01–T36 的**实际结果**。基线 `main = 11855e6`，
> 工作分支 `feat/t01-t36-sftp-integrity-rc`。
>
> 判定规则：**没有在当前 HEAD 上真实跑过的东西，不写成 PASS**。`AUTOMATED_ONLY`
> 表示有真实测试但只覆盖链路的一段；`NOT_RUN` 表示本轮没有执行；`BLOCKED_EXTERNAL`
> 表示缺设备、证书或账户。

## 零、本轮的总判断

| 问题 | 结论 |
| --- | --- |
| 是否可以内部测试？ | **是**。`pnpm verify` + GUI E2E + 真实 sshd 全绿（见 §五） |
| 是否达到个人 Core Daily Driver Ready？ | **否**。七天真人使用未执行（`DAILY_DRIVER_7DAY = NOT_RUN`） |
| 是否达到 Signed Public Release Ready？ | **否**。签名/公证/正式 updater 密钥均 `BLOCKED_EXTERNAL` |

---

## 一、本轮修复的真实缺陷

每一条都有先红后绿的测试、变异验证，以及（除标注外）在真实环境中的复现。

### F1 — 传输完成从不校验完整性（T03–T06）

`sftp_local_checksum` / `sftp_remote_checksum` / `verifyChecksum` / store 的比较逻辑
都有实现、有测试，**唯一的调用方是一个 re-export**。每一次上传下载都以
`checksum: undefined` 结束，「完成」与「两端一致」在 UI 上长得一模一样。

修复：`sftp-transfer-verify.ts` 在 `done` 之后、槽位释放之后启动校验，并持有一个
**用本次传输自己的 `sessionId`** 取的 claim。校验不占并发槽位。

- 先红后绿：`sftp-transfer-integrity.test.ts`（移除接线 → 5 红）
- 生命周期：`sftp-transfer-verify-lifecycle.test.ts` 6 项（校验期间会话不空闲、
  结束后释放、校验器抛错记为 indeterminate、已关闭会话不启动校验）
- UI：`transfer-row.test.tsx` 10 项，断言 `data-integrity` 的具体值

### F2 — 校验在真实 GUI 里永久停在 85%（T04）

`e2e-06` 实测：3 MiB 上传完成后，校验进度停在 85%，连续 30 秒 12 次采样读数完全
相同。Rust 侧同一操作 6 秒完成，所以缺陷在前端事件层。

根因：`verifyChecksum` 依次跑本地与远端两个 Rust 命令，**两者都发 `checksum-start`**，
而 channel 对每个 `checksum-start` 都调 `initChecksum` —— 后者把整个 `checksum`
对象重建，把已经算完的 `localStatus: 'done'` 拨回 `pending`。`checksum-progress`
只带远端一侧，没有任何东西再把本地设回去。

修复：start 事件只初始化**它命名的那一侧**，已定论的一侧保持原值。

- 先红后绿：新增 2 项（其中 1 项在修复前精确红在 `expected 'computing' to be 'done'`）
- 修复后真实 GUI：9 ms 完成，`data-integrity="verified"`
- 变异：恢复重建逻辑 → 1 红

### F3 — 校验进度覆盖已完成的传输字节（T05）

`updateChecksumProgress` 直接写传输记录的 `bytesDone`/`bytesTotal`。100 MiB 传完后
一次 20 MiB 的校验会把已完成的行显示成「20 MB / 100 MB，20%」，并算出负速度与错误
ETA。修复：校验进度写在自己的字段里。

### F4 — 「已保存」在 UPDATE 匹配 0 行时仍然是假的（T10）

`host-update-args.test.ts` 已记录前半（参数错位让 `WHERE id = ?` 收到
`agent_forwarding`），但**结果没修**：`retirePreviousVersion` 不看 `rowsAffected`。
清除凭据、切到 agent、正常写入三条路径都会在 UPDATE 落空时照样删除 Vault 里的旧版本
——秘密消失，行仍指向它。

修复：三条路径都在删除旧版本之前要求 UPDATE 真的影响了一行，落空即抛可见失败。
缺失的 `rowsAffected` 按「已匹配」处理（否则每次正常保存都会抛错）。

- 先红后绿：`hosts-update-rows.test.ts` 7 项（3 项在修复前红）
- 变异：移除 clear 守卫 → 1 红

### F5 — 查询失败被当成「没有这台主机」（T12）

`select()` 吞掉所有异常返回 `[]`。对列表视图正确，对凭据决策错误：
`getHostById` 在数据库锁住时返回 `null` → 连接路径读成「没有凭据」；
`updateHost` 抛「主机不存在」；`deleteHost` 删掉行却把密文永久留下。

修复：三处改用 `selectStrict`。列表视图保留宽松行为，并有测试钉住**哪个 helper 被
调用**（容忍本身是 `select()` 的性质，不是 `getHosts` 的）。

- 先红后绿：`hosts-strict-reads.test.ts` 6 项
- 变异：删除路径改回宽松 select → 2 红

### F6 — 两个并发保存只有一个生效（T11）

两个 `updateHost` 都读到 version N，都算出 N+1，第二个写覆盖第一个的密文，各自按
自己以为的 `previousVersion` 去退休。用户按两次保存，只得到一次效果。

修复：`host-write-lock.ts` 按主机串行化「读 → 算版本 → 写 → 退休」。不用 CAS 的
理由：版本比较要写进 SQL，而 `credential_ref` 是随版本演进的 JSON 文本。

- 先红后绿：`hosts-concurrent-update.test.ts` 4 项（屏障交错，修复前 2 红）
- 变异：移除锁 → 2 红

### F7 — 浮层可见性由 CSS 动画承担（T09 过程中发现）

Radix 浮层的入场类 `animate-in fade-in-0` 把 opacity 完全交给 keyframes，而
Radix 的 `usePresence` 依据 `animationName !== 'none'` 等待 `animationend`。

无焦点或离屏的真实 WebView 不推进动画时间轴。实测：

    animation: "enter"  animationPlayState: "running"  opacity: "0"

两个后果：**mkdir 对话框存在、可聚焦、`elementFromPoint` 命中它自己，但用户看不到
也点不到**；关闭后全屏 overlay（`z-[210]`）永不卸载，整个应用不可交互。

修复：dialog / alert-dialog / dropdown-menu / context-menu / select / sheet 的类字符串
去掉全部动画类。

- 守护：`overlay-animation-policy.test.ts` 5 项 + 变异验证
- 写这条守护时第一版是**空转的**（过滤排除了所有类字符串，变异后仍 5/5 绿），
  已修正并加空洞断言

### F8 — 差分块被构建进生产包（T07）

`if (VITE_TERMINAL_GUI_E2E === '1') { await import(…) }` 在 async 函数里编译成 Vite
的 import 包装，条件无法静态折叠。改为布尔常量后生产包 0 个分块；
`check-gui-e2e-isolation.mjs` 增加**正向**断言，7/7。

### F9 — `generate_context!` 让 Cargo 看不见 `dist/`（T07）

宏在展开时嵌入前端，Cargo 不知道宏读过 `dist/`，前端变更不使 crate 失效 —— 只改
前端的构建会发布**上一版** UI。按 Tauri 官方方案改用 `tauri-build` 的 `codegen` +
`tauri_build_context!`。

### F10 — fixture 路径守卫可被符号链接绕过（T08）

`underRoot` 只做词法包含检查。`root/link -> /outside` 词法上在根内，所有 `fs` 调用
都跟随；`seedFile` 的 `mkdirSync(recursive)` + `writeFileSync` 因此可以往真实目录写
文件。

修复：逐段 `lstat` + `realpath` 的物理检查，拒绝悬空链接与指回根自身的环。

- 先红后绿：`server-state-escape.test.mjs` 10 项（修复前 4 红）
- 变异：移除物理检查 → 4 红

### F11 — 认证失败无法按结构区分（T16）

`AuthenticationFailed` 同时表示「凭据被拒」与「认证期传输故障」。前端只能靠文案猜，
两个方向都错过：含 "timeout" 的被拒密码走完五次退避；agent 起不来说成「密码错误」。

修复：新增 `authentication_rejected` / `authentication_transport_failed` /
`host_key_rejected` 三个 kind，按构造点分类；前端按结构判定。

- Rust：4 项分类测试；前端：5 项
- 变异：移除结构性分类 → 1 红

---

## 二、真实环境证据

### 真实 GUI 上传下载（`e2e-06`，macOS arm64 WKWebView）

| 项 | 结果 |
| --- | --- |
| 上传 3 MiB | 本地与服务器 SHA-256 一致（`matches: true`） |
| 下载 2 MiB | 同上 |
| 产品自己的 verdict | `verified`，9 ms 内完成 |
| 取消选择器 | 不产生传输记录 |
| `notRunCount` | 4（原生对话框本身、高延迟链路、WebView 内并发超限） |

这份证据同时证明了 F2 的修复：修复前同一 case 停在 85% 30 秒不动。

### 真实 Vault 应用链路（`vault-app-e2e`，12/12 PASS）

创建 → 存秘密 → 错误密码拒绝 → 读回 → 改密 → 旧密码拒绝 → 新密码可读 → 重启 →
旧密码仍拒绝 → 新密码读回同一秘密 → 日志中无密码/秘密。证据
`docs/phase10/evidence/vault-app-e2e-2026-11-22.json`。

第一次跑失败是配置问题（缺 `VITE_TERMINAL_SMOKE_BUILD=1`），不是产品问题——记录在此，
因为「探针不存在」与「Vault 坏了」在报告里长得一样。

### 真实 sshd SFTP（Rust command-level）

6/6 通过，含本轮新增的「上传完成后立刻流式读同一 session」（30 s 上限）——它把 F2
定位在前端事件层，而不是传输层。

### e2e-03（SFTP 文件操作）

当前 HEAD 上 `verdict: FAIL`，但断言前进了：服务器侧已确认 mkdir 真的创建、rename
后新旧名正确、delete 后不存在。失败点是后续超时与 dock 宽度下 refresh 不可点。

**这两个用例在改动前的 main 基线上同样失败**（已用 `git stash` 对照验证），不是本轮
引入的回归。

---

## 三、T01——历史证据与隐私审计

PR #147 入库的 `e2e-04` / `e2e-05`：

| 事实 | 值 |
| --- | --- |
| `source.dirty` | 两份都是 `true` |
| `e2e-04` SHA | `cb045a8…`，**不是 main 祖先** |
| `e2e-05` SHA | `83d51a8…`，**不是 main 祖先** |
| `e2e-04` 内容 | 记录的是随后被 `c5b38e0` 修掉的 `Uptime 20767d` 缺陷 |
| 截图引用 | 两份都指向 `.gitignore` 排除的 `screens/*.png`，未入库 |

**结论**：这两份是 `HISTORICAL_EVIDENCE`，不是当前版本的 `PASS`。

**隐私**：`e2e-05` 的 `notes` 含真实用户名与设备名（`liuzhiwei@liuzhiweideMacBook-Pro`）。
这是本地终端的 shell 提示符回显，不是凭据。仓库为 **public**。

处理建议（**本轮不执行**，因为手改历史证据违反本仓规则）：添加一个显式的脱敏规则到
`evidence.mjs` 的 `redact()`（匹配 `user@host` 的提示符形态），并用官方流程重跑
e2e-05 生成新的脱敏记录；旧记录保留并在文档标注「含本机用户名」。当前证据已入库，
**不宣称它是干净的**。

---

## 四、Gap 清单（当前 HEAD 的三平台 GUI）

以 PR #147 合并后的 Native GUI run `44987153137` 为准（三平台均 success）：

| case | 三平台 verdict | Gap ID | 真实限制 |
| --- | --- | --- | --- |
| e2e-01 | PASS | — | — |
| e2e-02 | PASS | — | — |
| e2e-03 | PARTIAL nr=1 | `native-file-picker-not-drivable` | 上传下载需原生对话框 |
| e2e-04 | PARTIAL nr=2 | `real-model-answer` | 无授权模型端点（`BLOCKED_EXTERNAL`） |
| e2e-04 | | `snippet-draft-capture` | 由 e2e-05 覆盖，不重复 |
| e2e-05 | PASS nr=0 | — | — |
| **e2e-06（新增）** | 本机 macOS 实测 | `native-file-picker-not-driven` | 原生对话框本身未被驱动 |

`e2e-03` 的 `native-file-picker-not-drivable` 在 e2e-06 中被**部分闭合**：路径来源
被替换（E2E-only 编译分支），路径之后的每一步是生产代码。原生对话框本身仍未驱动。

---

## 五、门禁结果（当前 HEAD）

| 门禁 | 结果 |
| --- | --- |
| 前端测试 | 322 文件 / 2979 项 |
| typecheck | 通过 |
| ESLint | 0 error / 0 warning |
| source-size | 768 生产文件 |
| Rust lib | 456 项（+ 4 项分类 + Rust SFTP command-level 6 项） |
| `cargo fmt --check` | 通过 |
| GUI 隔离门禁 | 7/7（含新增的正向 file-picker 断言） |
| fixture 测试 | 32 项 0 失败 |
| 真实 GUI e2e-06 | 6 passing，证据 `verdict: PARTIAL`（4 项 NOT_RUN） |

---

## 六、未完成项（如实记录）

| ID | 状态 | 原因 |
| --- | --- | --- |
| `NATIVE_FILE_DIALOG_DRIVEN` | `NOT_RUN` | WebDriver 无法驱动 OS 对话框 |
| `e2e-03` mkdir/delete 完整链路 | `PARTIAL` | 服务器侧已确认，GUI 侧后续步骤超时 |
| `dock_refresh_clickable_at_300px` | `PARTIAL` | 实测不可点，未定位到最终根因 |
| `WINDOWS_NSIS_A_TO_B` | `BLOCKED_EXTERNAL` | 需一次性 Windows 环境 |
| `LINUX_APPIMAGE_STOCK` | `NOT_RUN` | headless WebKit 限制 |
| `SIGNING_NOTARIZATION` | `BLOCKED_EXTERNAL` | 无证书 |
| `UPDATER_PROD_KEY` | `BLOCKED_EXTERNAL` | 正式密钥未配置 |
| `DAILY_DRIVER_7DAY` | `NOT_RUN` | 需七天真实使用 |
| `REAL_MODEL_ENDPOINT` | `BLOCKED_EXTERNAL` | 无授权端点 |
| `PHYSICAL_KEYBOARD_IME` | `NOT_RUN` | 需人工键入 |
| `LONG_RUN_RESOURCE_LEAK` | `NOT_RUN` | 需长时间运行采样 |
| `T17_REAL_SSHD_RETRY_BUDGET` | `AUTOMATED_ONLY` | 分类有测试，真实双 sshd 的尝试计数未跑 |
| `T13_HOST_STATE_MATRIX_REAL_DB` | `AUTOMATED_ONLY` | 各方向有 mock 测试，真实 SQLite 矩阵未建 |

---

## 七、结论

**本轮把三件「机制存在但没人驱动」的事接上了生产路径**：完整性校验（原本零调用方）、
凭据更新的行命中守卫（原本不看 `rowsAffected`）、认证失败的结构化分类（原本靠文案）。
附带修掉一个会让整个应用看起来死掉的 UI 缺陷。

`DAILY_DRIVER_READY = NO`、`TABBY_REPLACEMENT_READY = NO`、
`SIGNED_PUBLIC_RELEASE_READY = NO`。三项都不是本轮工作量的函数，而是尚未执行的人工
验收与外部条件的函数。
