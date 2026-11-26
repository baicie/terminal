# RC Readiness Report — Core Daily Driver

基线 `main = 393ba6de7996b88f296f72f97932b7a35788363b`（PR #149 合并后）。
本轮执行 RC01–RC24，分四个 PR 边界。

---

## 一、判定分列（不合并成一个状态）

任务书要求区分「核心功能」「真实 PTY/SSH/SFTP」「Credential Safety」「三平台 GUI」
「资源稳定性」「安装升级」「七天真人日用」「正式签名发布」。前七项是内部 QA 与个人
日用的证据，第八项是公开发布——**它们的结论不同，混在一起会掩盖缺的那部分**。

| 面 | 判定 | 依据 |
| --- | --- | --- |
| 核心功能实现 | **PASS** | 前端 332 文件 / 3046 项、Rust 460 项、脚本 920 项 |
| Credential Safety | **PASS**（5 个 P0/P1 已修） | RC01–RC06，见 §二 |
| SFTP 网络故障 | **PASS**（一处归因纠正） | RC07–RC12，见 §三 |
| 终端运行时 | **PARTIAL** | RC13/RC14 定论，RC15–RC18 见 §四 |
| 三平台 GUI | **PASS（CI）** | macOS 7m46s / Linux 12m22s / Windows 19m32s，全 success |
| 资源稳定性 | **NOT_RUN** | 需真实 GUI 长时运行 |
| 安装升级 | **PARTIAL** | macOS/Linux 已验证，Windows NSIS `BLOCKED_EXTERNAL` |
| 七天真人日用 | **NOT_RUN** | 必须由用户完成 |
| 正式签名发布 | **BLOCKED_EXTERNAL** | 无 Apple/Windows 签名与生产 Updater Key |

```
CORE_DAILY_DRIVER_READY   = 未达成（缺七天真人日用）
INTERNAL_QA_READY         = PASS
SIGNED_PUBLIC_RELEASE     = BLOCKED_EXTERNAL
```

---

## 二、Credential Safety（RC01–RC06）

五个真实缺陷，全部先红后绿并有变异验证：

| ID | 缺陷 | 严重度 | 证据 |
| --- | --- | --- | --- |
| RC01 | 重复 Host ID 的创建**删掉原主机的密文** | **P0** | 真实 SQLite：`secretStillReadable: undefined`、`vaultAfter: {}` |
| RC02 | create/delete 不共享 update 的写锁；两种交错都丢密文 | **P0** | `vaultKeys: []` 而行存活；`expected undefined to be 'NEW'` |
| RC03 | SSH Key 有同形缺陷，且 create/update/delete **三个路径全无锁** | **P0** | `privateKeyStillReadable: undefined` |
| RC04 | 损坏引用被折叠成「从未保存」→ update 覆盖 version 1、getSecret 返回空材料 | P1 | promise 静默 resolve；`{}` 而非拒绝 |
| RC05 | `key → password` 后旧私钥留在新版本 | P1 | `{password, privateKey}` 而非 `{password}` |

RC06 崩溃矩阵：真实 SIGKILL 打断产品的 `createHost`/`updateHost`，4/4 通过。
写入顺序（先 vault 后行）保证了崩溃只可能留下**孤儿密文**，不可能留下**不可恢复的行**。

### 一处诚实标注

`discardFailedCreate` 的 `ownsNoRow` 守卫在 RC02 的锁下**不可达**——去掉它 RC02 与
RC06 都不变红。已在源码注释写明它是防御性的，以及它在什么条件下才变成真的。

---

## 三、SFTP 网络故障（RC07–RC12）

**RC07 纠正了 #149 的归因。** #149 把「cut-upload 断流后 30/60/180/300 秒无 verdict、
一次挂起 77 分钟」记为 `russh-sftp` 写路径的 `NOT_PROVEN` 风险。核对后：

- 挂起的是**测试夹具** `seed_remote` 的裸 `session.create().write_all()`，无超时；
- 产品的 `staged_upload` 对**每一处**远端 I/O 都套了 `bounded()`（20 秒）；
- 变异验证：去掉 `bounded` → 挂起超 90 秒；有它 → 0.28 秒返回。

| ID | 结论 |
| --- | --- |
| RC08 | 预算施在**单次往返**（64 KiB chunk），不是整文件——慢网大文件不误杀 |
| RC09 | 超时后不再发写入、目标不变、staging 不残留（变异：加重试 → `saw 2 attempts`） |
| RC10 | 原文件保护的既有覆盖已充分（写入/flush/close/rename/断流/permission denied） |
| RC11 | 20 轮断流+恢复，staging 与目标不累积（变异：漏删 staging → 红） |
| RC12 | **下载身份缺本地路径**——两个下载写同一本地文件互不可见，都可报 `verified` |

---

## 四、终端运行时（RC13–RC18）

| ID | 判定 | 说明 |
| --- | --- | --- |
| RC13 | **VERIFIED** | 1440px 的 +224 异常**已消失**：`896 = 1440−46−182−300−16` |
| RC14 | PARTIAL | 100 次 resize 有界、双 Pane 各自 fit、dispose 隔离；共享节流的变异是行为等价，见下 |
| RC15 | PARTIAL | 重试预算实现完整且有测试；**服务端计数 NOT_RUN** |
| RC16 | PARTIAL | Two-hop 凭据已在真实 sshd 验证；断连矩阵 NOT_RUN |
| RC17 | PARTIAL | Rust 侧 10 MiB 背压 PASS；**真实 WebView NOT_RUN** |
| RC18 | **NOT_RUN** | 需要真实 GUI 长时运行 |

RC14 有一条要说清楚：我想用「节流状态模块级共享」模拟双 Pane 干扰，**四次都没能让
变异变红**，最后查明它是**行为等价**的——`requestFit` 在节流窗口内会 `setTimeout`，
只延迟不丢弃，最多晚 32ms。这不是可捕捉的缺陷。用例保留为冒烟测试并写明限制。

RC15–RC18 的 NOT_RUN 原因相同：需要真实 GUI 会话或双跳 fixture，本轮按用户要求
不启动应用窗口。

---

## 五、产品级交付（RC19–RC24）

### RC19 — UX 问题清单：NOT_RUN

需要真实截图（首次启动、快速连接、搜索、Tab/Split、错误恢复、SFTP、Vault、Snippet、
Command Palette、Settings，三尺寸 × 双主题 × 双语）。**不启动 GUI 就无法采集**。

不列「我认为可能有问题的地方」——那是猜测，不是清单。

### RC20 — 键盘与输入法：NOT_RUN（人工清单见下）

| 类别 | 自动化能做的 | 需真人 |
| --- | --- | --- |
| Ctrl+C / Ctrl+F / Readline / Tab | WebDriver 可驱动 | — |
| Vim / tmux | 可驱动，但价值在于真实按键节奏 | 建议真人 |
| 中文 IME / dead key / 物理键盘重叠 | **不能** | 必须真人 |
| 系统剪贴板 | 部分 | 建议真人 |

#149 已记录 WebKit WebDriver 的 Tab 行为限制，不再用程序化 focus 冒充真实键盘。

### RC21 — Windows 安装升级：`BLOCKED_EXTERNAL`

沿用 `docs/phase9-5/release-blockers.md` 的结论：隔离预检 PARTIAL（已 fail-closed），
A→B 升级 **NOT_RUN**，需一次性 profile 或 VM。**Windows Tauri build 成功不等于安装
升级成功**，两者不互相替代。

### RC22 — GUI CI 覆盖与效率

#149 之后（run `45327535685`，全 success）：

| 平台 | 耗时 | 性质 |
| --- | --- | --- |
| macOS | **7m46s** | 强制门禁 |
| Linux | **12m22s** | informational |
| Windows | **19m32s** | informational |

`t09`、`t11`、`r04` 三个 spec 已纳入官方报告（`gui-e2e-report.mjs` 会读它们的
`extra.gaps`/`notRunCount`；RC04 的散文写法曾被判 `FAIL` 并已修正）。

**不擅自把 Windows/Linux informational 改成强制门禁**。若需要，应单独提 ADR。

### RC23 — 证据与隐私

| 项 | 状态 |
| --- | --- |
| 新证据持续脱敏 | **PASS**（`redact`/`redactDeep` 覆盖 notes/terminal/command/extra；三条路径规则实测有效） |
| 当前 manifest 的 Source SHA | **FAIL —— 六份证据指纹过期** |
| 历史六个文件含本机标识 | PARTIAL（已被取代，未改写历史） |

**指纹过期是本轮源码改动的必然结果**，不是缺陷：`FINGERPRINT_PATHS` 包含
`packages/frontend/src` 与 `src-tauri/src`，而 RC01–RC12 都在这两个目录里。
按仓库规则，**不得修改旧 manifest 让它变绿**，必须用
`.github/workflows/real-machine-matrix.yml` 在当前 HEAD 重采。

```
EVIDENCE_FINGERPRINT_CURRENT = NO   （需重采，见 §六）
```

### RC24 — 本文件

---

## 六、未完成项与需要的条件

| 项 | 需要什么 |
| --- | --- |
| 六份验收证据重采 | `real-machine-matrix` 工作流在当前 HEAD 跑一次，提交产物 |
| RC15 服务端重试计数 | 允许密码认证的隔离 fixture + sshd 日志解析 |
| RC16 断连矩阵 | 两个隔离 sshd + 可控断连 |
| RC17 真实 WebView 大输出 | 启动 GUI |
| RC18 100 轮资源曲线 | 启动 GUI 并长时间运行 |
| RC19 真实截图 | 启动 GUI |
| RC20 真人键盘 | 用户本人 |
| RC21 Windows NSIS | 一次性 profile 或 VM |
| 七天真人日用 | 用户本人 |
| 正式签名发布 | Apple Developer ID、Windows Authenticode、生产 Updater Key |

---

## 七、回滚

逐提交 `git revert` 即可。本轮**没有**数据库 schema 变更、没有迁移、没有凭据格式
变更。新增的 `localPath` 是可选字段，旧证据与旧数据不受影响。

---

# F01–F24 收口轮（2026-11-25）

任务书：Terminal Next — Final Runtime Reliability & Daily Driver RC。
本节是对上面那份报告的**增量更新**，不是另一份报告；上面各节仍然有效，冲突时以本节
的实测数字为准。

## 八、本轮找到并修掉的真实缺陷

四个，全部由真实运行暴露，没有一个来自阅读代码。

| # | 缺陷 | 后果 | 如何发现 |
| --- | --- | --- | --- |
| 1 | 自动重试阶梯耗尽后只写 `error: lastError` | 双跳连接用尽重试预算后只显示「authentication rejected」，用户不知是跳板还是目标的账号 | 先红测试；`terminal-session-manager-reconnect.ts` |
| 2 | `enforce_authentication_deadline` 把所有内层错误转成 `AuthenticationTransportFailed` | **跳板拒绝被重试 6 次**，且前端永远收不到 `bastion-auth-rejected` | 真实双跳 smoke 实测 |
| 3 | `SessionManager::shutdown` 持 `lifecycle` 锁跨调 `close_all()`，同一把不可重入的 tokio Mutex | 清理永不完成 → 进程在 `finalized` 之后挂满 210 秒 | 真实场景退出时超时 |
| 4 | 退出路径靠 `app.exit()` 的请求「复活」 | 清理 0.4 ms 完成，进程仍不退出：`prevent_exit` 取消的请求不会被重放 | 加 trace 定位 |

**缺陷 3 与 4 是同一个症状的两个层次**：先修掉自锁，仍然卡住，才发现退出请求本身丢了。
两次都记在提交里，没有把第一次的错误结论当成结论。

### 「绿了但核不了」的三种形态

F12 这条判定的三轮，每一轮的绿都是**真的**绿在那一步能证明的事情上，但都不足以
支撑「三场景在 CI 上跑过并归因正确」这句话。三种形态值得单列，因为它们由同一份
心智模型产生，而每一种单独看都像通过：

| 形态 | 表现 | 为什么读起来像通过 | 怎么发现的 |
| --- | --- | --- | --- |
| 失败不设退出码 | 三场景全 FAIL，job success | verdict 打印在日志里，job 状态是绿的 | 更新 RC 判定时去核对日志 |
| 前置条件缺失 | 三场景死于 `gobject-sys`，与产品无关 | 退出码修好后**如实报红**，但红的原因不是产品 | 第二次运行仍红，读 cargo 输出 |
| 结果不可核对 | 真绿，但报告从不写盘、通过场景不打日志 | 退出码为 0 且确实跑了 | 想从 artifact 里取矩阵结果，发现文件不存在 |

第三种最难发现：**前两种都会在某个时刻变红，第三种永远是绿的。** 一个产物从不生成的
`upload-artifact` 步骤、一个只在失败时打印的循环，合在一起就构成「看起来像覆盖」。
判据不是「有没有这一步」，而是「从 run 留下的东西里能不能读出它做了什么」。

## 九、本轮补上的证据层级

| 面 | 之前 | 现在 |
| --- | --- | --- |
| 真实双跳用例 | 8 条，**不在 CI** | **11 条，进 CI 且阻塞合并**（`real-ssh-jump` job） |
| 多机身份隔离 | `NOT_RUN`（`PermitOpen` 只允许一个目标，问题不可达） | 四机矩阵通过：同跳板两目标、两跳板同目标、跨跳板密钥被拒 |
| 连接链路时间预算 | 无断言 | 6 阶段共享一个预算；变异去掉钳位 → 红 |
| 资源回收 | 单点 | 12 轮连接/断连后产品自身资源视图回到零 |
| 真实 PTY 生命周期 | 分段 | 一轮完整：输出→输入→resize→EOF→回收，nonce 匹配 |
| 混合会话隔离 | 无 | 邻居仍注册且可用；一条会话的清理不碰别人的 channel |
| 失败诊断一致性 | 无 | 面板/分类器/连接日志三方逐字段一致（5 种情形 + vault） |
| 终端失败写日志 | **从未写入** | 首连终态与阶梯耗尽各一次，日志不含任何凭据（canary） |
| GUI 失败诊断 | **无任何用例** | 新增 `e2e-07`（见下） |

## 十、判定

三项分开给，不合并：

```
INTERNAL_QA_READY          = YES
CORE_DAILY_DRIVER_READY    = NO   （七天真人日用未执行）
SIGNED_PUBLIC_RELEASE_READY = NO  （签名/公证/updater 密钥 BLOCKED_EXTERNAL）
```

`INTERNAL_QA_READY=YES` 的依据是第九节那批门禁：内部能够证明的都证明了，证明不了的
都列为 NOT_RUN 而不是猜成 PASS。它**不**表示产品可以发布，也不表示已经好用。

`CORE_DAILY_DRIVER_READY` 保持 NO 的唯一原因是任务书本身规定的「七天真人日用」——
那需要用户本人，任何脚本都不能代替。

## 十一、仍未完成（如实列出）

| 项 | 状态 | 需要什么 |
| --- | --- | --- |
| `e2e-07` GUI 失败诊断 | **PASS（macOS + Linux）** | 四轮才通过。前三轮的失败都是真结论：两轮是用例写错（没进 Hosts 路由；等「页面里有错误字样」，1.6 秒被主机列表本身满足），第三轮对上了产品——连接被拒被说成「无法验证 SSH 主机密钥」，且内部调用栈直出。`9f9e3bd` 上 macOS（阻塞）与 Linux 两条 case 全 ✓、`notRunCount: 0`。**这一行是矩阵里唯一达到 `NATIVE_GUI_VERIFIED` 的** |
| F12 断连注入 | **PASS（bastion 腿，三场景；CI 已可核对）** | 逐场景驱动（`an_injected_fault_names_its_own_leg_and_no_more`）断言**归因**而不只是「失败了」。本地三场景全过，`reset` 的 `cut: 1` 证明注入真的切断了连接。**这条判定花了三轮才立得住**，每轮都是真结论：① run 45758649504 三场景全失败而 job 报绿——`finish('FAIL')` 不设退出码（`#164` 修）；② 同一轮三场景死于 `gobject-sys` 编译竞态，根因是 job 从未装 Tauri 系统库（`#164` 修）；③ run 45786015950 真绿了，但**矩阵的逐场景结果从任何产物都核不了**：`ci.yml` 从未设 `SSH_JUMP_E2E_REPORT`，报告文件从不写盘，upload 自加入起一直 `No files were found` 空转；通过场景在日志里也是静默的（`#165` 修，并把 `if-no-files-found` 改 `error`）。**只覆盖 bastion 腿**——跳板连接不直连目标，`PermitOpen` 只放行目标真实端口，目标腿无法整形 |
| F13 自定义策略真实执行 | **NOT_RUN** | 出货的 `terminalSessionManager` 不收参数，自定义退避到不了真实后端 |
| F14 100 轮 soak | **PASS（本地 100 轮）** | 真跑完 100 轮：RSS 15.63→15.96 MB（峰值 16.01，**终值低于峰值**）、FD 恒 9、`NO_LEAK_DETECTED`。12 轮的快速回归在 CI 每次跑。**这是本机结果**，尚未在 CI 派发过 100 轮 |
| F17 RSS/FD 曲线 | **PASS（Unix，采集+判读）** | `session::process_metrics` 真实测量（macOS `proc_pidinfo`、Linux `/proc/self`），soak 每轮采样，判读是纯函数 `scripts/ssh-soak-curve.mjs`（13 项测试）。**Windows 返回 `None` 而非 0**——0 会进曲线并伪装成完美平坦。判读规则被测试改过一次：只看相对比例会漏掉大基线上的真实泄漏（2 GiB 涨 156 MiB = 7.6%），已加持续性判据 |
| Windows 三平台故障矩阵 | **NOT_RUN** | 一次性 profile 或 VM |
| 七天真人日用 | **NOT_RUN** | 用户本人 |

**合并前独立审查推翻的分类（已修）**：`map_session_error` 把 `AuthenticationRejected`
与 `HostKeyRejected` 压成 `ConnectionFailed`，而 F22 的分类器对未识别的
`connection_failed` 兜底成「服务器没应答」——跳板拒凭据、跳板密钥不符、隧道后非 SSH
服务三种情况都会错报成机器没响应。已把「服务器做出的决定」排在传输症状之前，兜底
改为更弱的「握手失败」。详见 `36-ssh-runtime-acceptance-matrix.md`。

## 十二、人工验收清单（按优先级）

1. 打开应用，连一台不可达的主机 → 面板必须说出原因，不能是空白终端。
2. 配一条双跳，把跳板密码改错 → 必须说「跳板」，不是「目标」，且**只试一次**。
3. 同一场景把目标密码改错 → 必须说「目标」，且只试一次。
4. 连上后拔网线 / 关 Wi-Fi，等 30 秒再恢复 → 会话自行恢复，或给出可读的原因。
5. 断开一个会话，确认另一个仍在收发数据。
6. 看 Logs 视图：失败的连接应有记录，且记录里没有任何密码或私钥。

## 十三、外部条件清单

- Apple Developer ID 与 notarization
- Windows Authenticode
- 生产 Updater 签名密钥
- 一台 Windows 机器（或 VM）用于 NSIS 升级 E2E
- 七天真实使用数据

## 十四、结论

主动功能研发到此收敛。剩下的事项都需要真实用户或外部条件，继续加功能只会增加未被
验证的面积。**建议进入真实使用。**
