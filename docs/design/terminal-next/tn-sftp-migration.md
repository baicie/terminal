# TN-SFTP — UX-1i 遗留能力定向迁移

- 角色：Tauri / React / 测试工程
- 日期：2026-11-14
- 基线 `main`：`825bcd3deb6680f89055d21fd0c4c28e1824ad86`
- 方式：**定向迁移**。未整体 merge、未 cherry-pick UX-1i 分支。

---

## 0. 判定速览

| 判定 | 结果 |
| --- | --- |
| `SESSION_CLAIM_ATOMIC` | **PASS** |
| `DIALOG_CANCEL_SAFE` | **PASS** |
| `HOST_SWITCH_SAFE` | **PARTIAL** |
| `DOCK_CLOSE_TRANSFER_SAFE` | **PASS** |
| `TRANSFER_QUEUE_COMPATIBLE` | **PASS** |
| `REFRESH_AFTER_COMPLETION` | **PASS** |
| `NO_STALE_HOST_REFRESH` | **PASS** |
| `COMPACT_DOCK_USABLE` | **PARTIAL** |
| `SFTP_24MIB_ROUNDTRIP` | **PASS** |
| `REAL_GUI_E2E` | **NOT_RUN** |
| `EVIDENCE_INTEGRITY` | **FAIL**（已确定原因，需按流程重采） |

---

## 1. 交付物

| PR | 内容 | 基线 |
| --- | --- | --- |
| #47 | TN-SFTP-01 会话 Claim + 上传完成刷新 | `main` @ `825bcd3` |
| #48 | TN-SFTP-02 Compact Dock | `#47` @ `3281faf` |
| #49 | TN-SFTP-03 24 MiB 真实往返 | `#48` @ `1e88a88` |

三个都是 Draft，未自动合并、未打 Tag、未发布。按任务书要求**先完成第一项再推进 UI**，
所以 02/03 依次叠在前一个之上，评审时可按顺序看。

---

## 2. `SESSION_CLAIM_ATOMIC` = PASS

### 缺陷

`uploadFile()` / `downloadFile()` 在 `await prepareChannel()` 之后才 `scheduleTransfer()`。
`prepareChannel` 是一次 Tauri IPC 往返（安装 `sftp-progress` 监听器），而它之前还有系统
文件选择框——用户可以一直不回答。这段窗口里传输不在任何队列，
`hasTransfersForSession()` 回答「空闲」，Dock 关闭时 `releaseOrDefer()` 关掉连接，
上传随后用一个后端已丢弃的 `sessionId` 启动。

### 实现（`service/sftp-session-claim.ts`）

十条要求逐条对应：

| 要求 | 落点 | 证据 |
| --- | --- | --- |
| 首个 await 前同步取得 | `startTransfer()` 第一行 `claimSession()`；模块全同步，无 await | `the session is busy while the listener is still installing` |
| 同一 Session 多 Claim | `tokens: Set<string>` | `allows several concurrent claims on one session`、`a batch holds one claim per file`（count=3） |
| 唯一令牌 + 释放幂等 | 每 Claim 一个 token；`release` 内有 `released` 标志 | `gives every claim a distinct token`、`release is idempotent` |
| 关闭中拒绝新 Claim | `beginSessionClose()` 置 `closing` | `refuses a claim on a closing session` |
| 有 Claim 或活动任务就不释放 | `isSessionIdle()` = 无 Claim **且** 无 queued/running | `is false while a claim is outstanding even with an empty queue` |
| 交接无空窗 | 先 `scheduleTransfer()` 再 `claim.release()` | `the claim hands over to the queue record without a gap` |
| 所有异常路径释放 | 单一 `try/finally`，含 `scheduleTransfer` 抛错 | `releases the claim when the listener cannot be installed`、`... when scheduleTransfer throws` |
| 不伪造 running 占位 | Claim 不进 transfer store，不占 `runningSlots` | `getTransferQueueDiagnostics().runningSlotIds` 在 Claim 期间为空 |
| `MAX_CONCURRENT=3` 不变 | `sftp-transfer-queue.ts` 未改 | 既有队列测试全绿 |
| 不重复 `close` | 既有 `Map<sessionId, disposer>` 幂等性保留 | `closes exactly once after three calls while busy`（9 项仍绿） |

### 关闭顺序

`releaseOrDefer()` 先 `beginSessionClose()` 再问是否空闲。反序只把窗口挪后几微秒。
延迟释放的定时器**内建** `hasClaimsForSession()` 检查，所以传队列单源谓词的调用方
也不会丢保护——这一条是写测试时发现的：只改调用点的话，定时器仍会关掉被 Claim 的连接。

### 先红证据

把 `isSessionIdle` 改回队列单源：

```
× is false while a claim is outstanding even with an empty queue
× the session is busy while the listener is still installing
× downloadFile takes the same claim
× a batch holds one claim per file until the batch is scheduled
Tests  4 failed | 18 passed (22)
```

恢复后 22/22 通过。

---

## 3. `DIALOG_CANCEL_SAFE` = PASS

三个决定，写在 `view/sftp/use-sftp-transfer-actions.ts`：

| 期间 | 行为 | 理由 |
| --- | --- | --- |
| 对话框打开中 | **不取 Claim** | 用户尚未承诺传输。Dock 此时关闭、连接被释放是正确行为。若在按钮点击时取 Claim，取消路径必须逐条接线才不会永久锁住会话 |
| 返回 `null` | 不取 Claim、不写队列、不弹 toast | `open()`/`save()` 的 `null` 是「用户改主意」，不是错误 |
| 返回路径 | 交给 `uploadFile`/`downloadFile`，由它们在自己的首个 await 前取 Claim | 保护从「用户决定上传」那一刻开始 |

对应测试：

- `does not close while the file picker has not returned`（选文件 → 传输建立；取消 → 零 Claim）
- `a cancel of the file picker leaves no claim behind`

覆盖路径：工具栏按钮（`handleUpload`）、拖拽（`useSftpDrop` → `uploadPaths`）、
直接调用 `uploadFile`/`downloadFile`。三条都走同一个 `startTransfer()`，没有
「只保护 handleUpload 而漏掉服务 API」的分叉。

---

## 4. `HOST_SWITCH_SAFE` = PARTIAL

**成立的部分**：Host 切换与 Dock 关闭走同一个 `releaseSessionUnlessBusy()`，
`releaseOrDefer` 因此同样先拒绝新 Claim 再判断空闲。测试
`a host switch mid-preparation does not close the old connection` 用可控 Deferred
让 `prepareChannel` 挂住，在挂住期间发起释放：返回 `false`、`ssh.close` 未被调用、
上传仍在原 `sessionId` 上完成。

**为什么是 PARTIAL 而不是 PASS**：这套保护证明的是「旧连接不会在上传准备期间被关闭」。
它**没有**证明「切换主机后，UI 上显示的文件列表一定属于新主机」——那条由 UX-1c 的
pin 机制（`resolveSftpHostId` + `differsFromActiveTab`）负责，本轮没有改动它，也没有
为它新增测试。两件事相邻但不同，不合并计分。

---

## 5. `DOCK_CLOSE_TRANSFER_SAFE` = PASS

`sftp-dock-close-race.test.ts` 8 项，全部用可控 Promise 打开窗口而非 sleep：

| 场景 | 断言 |
| --- | --- |
| 监听器安装中关闭 Dock | 连接不关；`isDeferred` 为真；传输照常入队 |
| 文件选择框未返回 | 取消时不产生任何 Claim |
| 准备期间申请关闭多次 | `close` 恰好一次 |
| 关闭后再发起传输 | 被拒绝并产生可见的 error 记录 |
| 延迟窗口内出现新 Claim | 定时器不关闭（`busy` 全程为 false，只有 Claim 挡住） |
| 主机切换中途 | 旧连接不关 |
| 100 次开关循环 | `close` 恰好 100 次、`__deferredSessions()` 归零 |
| 最后一项结束后 | 恰好关闭一次 |

---

## 6. `TRANSFER_QUEUE_COMPATIBLE` = PASS

- `MAX_CONCURRENT = 3` 未改，`runningSlots` 同步预占逻辑未改。
- `sftp-transfer-queue.ts` 一行未改。
- `uploadPaths()` 的签名与返回值未改。**没有**把 `await uploadPaths()` 重新解释成
  「等全部完成」——现有调用方（`handleUpload`、`useSftpDrop`）都不依赖那个语义，
  改成那样才是破坏性变更，而且会让调用方 await 整个传输过程。
- 既有队列/幂等测试全绿：`sftp-transfer-queue.test.ts`、`sftp-transfer-session-guard.test.ts`、
  `sftp-deferred-release-idempotency.test.ts`（9 项，含「三次调用一次 close」）。

---

## 7. `REFRESH_AFTER_COMPLETION` = PASS

### 缺陷

`uploadPaths()` 在所有文件被**排进队列**时就 resolve。对三文件批次（`MAX_CONCURRENT=3`），
一个字节都还没动它就返回了，`handleUpload` 随即 `loadRemoteDir()`。用户看到「上传成功」
而列表里没有新文件。

### 实现（`view/sftp/use-upload-completion-refresh.ts`）

| 要求 | 落点 |
| --- | --- |
| 用 transferId 关联 | `settled: Set<string>`，同一 id 只计一次 |
| 仅后端真正成功后刷新 | 只有 `status === 'done'`；`queued`/`running`/`error`/`cancelled` 都不触发 |
| 失败/取消/排队不触发 | 同上，各有单测 |
| 按 Session + RemoteDir 合并 | `remoteDirOf(remotePath)` 从记录自身推导，不新增 store 字段 |
| Dock 关闭后不操作已卸载组件 | `dispose()` 置 `disposed` 并清定时器 |
| Host 切换后不刷新新 Host | target 变更时取消定时器并清空 `settled`；触发前再比一次 |
| 不重复触发成功 Toast | 本模块不产生 toast；`notify` 只在失败路径（未新增调用） |
| 订阅与监听清理 | effect cleanup 里 `unsubscribe()` + `dispose()` |

**合并窗口 250ms**：一批文件不是一次 store 更新——队列三路并发，12 个文件分四波落地。
每波刷新会在同一条 SFTP 通道上打四次目录列表。等一个静默窗口只多花零点几秒，
却只产生一次列表。

### 先红证据

把 `record.status !== 'done'` 放宽成也接受 `queued`（即旧的「入队即刷新」）：

```
× does not refresh when the transfer is only queued
```

第一版这个变异**没被抓到**——因为断言没推进定时器，定时器还没触发就断言完了。
补上 `vi.advanceTimersByTime` 后才真正锁住。这是本轮自己引入又修掉的测试缺陷。

---

## 8. `NO_STALE_HOST_REFRESH` = PASS

四条独立断言：

- `ignores another session` — 别的 session 的 `done` 不触发
- `ignores a file that landed in another directory` — 落在别的目录不触发
- `forgets the previous batch when the target changes` — target 变了之后旧批次不再触发
- `stops refreshing after unmount` — 卸载后不触发

---

## 9. `COMPACT_DOCK_USABLE` = PARTIAL

### 缺陷

Context Dock 恒为 300px。`useBreakpointMax('md')` 量的是**窗口**，在 1440px 视口里回答
「桌面」，于是 Dock 仍渲染 Local/Remote 双栏——每栏约 130px，文件名截断、按钮挤不下。

### 实现

| 决定 | 理由 |
| --- | --- |
| `ResizeObserver` 量容器（`use-container-width.ts`） | 唯一能区分「1440px 窗口里的 300px Dock」与「1440px 的 /sftp 页」的信号 |
| 未测量按窄处理 | 先双栏再塌缩是可见闪烁，先单栏不是 |
| 阈值 520px | 两栏各约 230px（扣 24px 内边距 + 12px 间距），够放名称列与大小列 |
| 隐藏栏保持挂载（`hidden`） | 卸载会丢目录列表、滚动位置与在途请求 |
| 单栏默认 Remote | 进入此视图的每条路径都是远程主机 |
| `isMobile` 仍强制单栏 | 横屏手机 CSS 宽度不小，但手机布局有自己的导航 |

**没有给 `SftpContainer` 加 `compact` prop**：`RightPanel` 恒为 `DOCK_WIDTH`，
容器测量自动同时覆盖 `column` 与 `overlay`，且不会出现「prop 说是 compact 但容器
其实很宽」的失配。

**未迁入 UX-1i 的 WP1 布局预算**：`chooseLayout` / `withHysteresis` /
`use-panel-layout.ts` 一行未改。

### 另外修的三处

1. `transfer-panel.tsx` 的 `w-80`（320px）在 300px Dock 里右侧溢出被裁，进度条与关闭
   按钮缺一角 → `max-w-[calc(100%-1rem)]` + `right-2 sm:right-4`。
2. 文件名 `max-w-[120px] sm:max-w-none` —— 120px 比 Dock 可用宽度窄，`sm` 步进在
   1440px 窗口的 300px Dock 里永不触发 → `min-w-0 flex-1` + 纯 `truncate`。
3. 操作菜单只有 `group-hover:opacity-100`，键盘用户摸不到 → 加 `focus-visible` 与
   `aria-label`（三语新增 `sftp.fileActions`）。

### 为什么是 PARTIAL

单栏/双栏是由 **vitest + stubbed `ResizeObserver`** 证明的，不是真实 Tauri 窗口量出来的。
`useContainerWidth` 的 `ResizeObserver` 本身、以及 Tailwind 在真实 WebView 里的实际
布局，都没有真机证据。真实尺寸需要 TN-03 harness 加一条 SFTP dock 用例，本轮未做。

功能保留：上传、下载、新建目录、删除、重命名、刷新、目录导航的 props 未变；
Host Pin 未改动；未触碰终端容器，PTY 不会重挂；`useSftpLocal`/`useSftpRemote` 各只有一份，
没有第二套业务状态。

---

## 10. `SFTP_24MIB_ROUNDTRIP` = PASS

真实 OpenSSH、真实密钥、真实 `sftp-server`（fixture `enableSftp: true`）。

```
✓ uploads 24 MiB through the sftp subsystem         805ms
✓ downloads it back and both sides still hash same 1031ms
✓ replacing a file leaves no backup/staging residue  380ms
✓ leaves no sshd process behind                      244ms
```

`features/sftp/` 三个文件共 13 项全绿（含 #43 的两份，均未被改动）。

### 与 #43 的关系（如实标注）

| 用例 | 状态 |
| --- | --- |
| 24 MiB 经子系统上传 | **新增**（#43 是 4 MiB） |
| 24 MiB 下载回程 + 两端摘要 | **新增**（仓库此前没有任何下载用例） |
| 替换无残留 | **与 4 MiB 用例重复**，保留并标注 |
| 无遗留 sshd | 此尺寸下新增 |

没有把重复项包装成新覆盖。

### 三层区分

| 层级 | 判定 |
| --- | --- |
| SFTP CLI fixture E2E | **PASS** — 客户端是 `/usr/bin/sftp` |
| Rust command-level E2E | **NOT_RUN** — 未调用 `sftp_upload` / `sftp_download` |
| 真实 Tauri GUI 产品 E2E | **NOT_RUN** |

---

## 11. `REAL_GUI_E2E` = NOT_RUN

本轮没有任何一步在真实 Tauri 窗口里操作过。所有 UI 相关结论来自 jsdom + stubbed
`ResizeObserver` / `matchMedia`。TN-03 的 harness（PR #45 已合并）可以跑，但本轮没有
为 SFTP 写 GUI 用例，也没有跑过任何一条。

不把它记成 PASS 的理由：单栏/双栏的 300px 判断、文件名的真实截断位置、传输面板
在 Dock 里的实际边界，都是 CSS 在 WebView 里的行为，jsdom 测不出来。

---

## 12. `EVIDENCE_INTEGRITY` = FAIL

实测：

```
Verification evidence gate failed: 7 problem(s).
- evidence-manifest.json was produced from source fingerprint d45be8132fe1…
  but these sources fingerprint as f4e9684d85bc…
- 六份 evidence 同样记录的是 d45be8132fe1…
```

原因确定且是本轮预期内的：三个 PR 都改了 `packages/frontend/src/**`，而
`scripts/check-verification-evidence.mjs` 的 `FINGERPRINT_PATHS` 第一条就是
`packages/frontend/src`。

处置：**未手改 manifest，未改 `FINGERPRINT_PATHS`**。按 `docs/release/workflow-rules.md`
第 1 节，正确顺序是「冻结源码 → 派发 macOS 证据 job → 下载产物 → 过门禁」，且
三项 PR 尚未合并，现在重采会在合并后再次失效。重采应在三项全部落地后执行一次。

---

## 13. WP1 / WP5 / WP6 处理

| 项 | 处理 |
| --- | --- |
| **WP1** 旧布局预算 | **不迁移**。#44 的 `chooseLayout` + `withHysteresis` 是更完整的实现（含 drawer 与按轴滞回）。`use-panel-layout.ts`、`layout-decision.ts`、`layout-hysteresis.ts` 一行未改 |
| **WP5** 真实传输 | 只提取 main 未覆盖的断言：24 MiB 经子系统、下载回程。4 MiB 与替换语义已在 #43，不复制 |
| **WP6** 灰屏调查 | 作为历史证据保留在原 worktree，未迁入。main 的 `src-tauri/Cargo.toml:34` 已有 `custom-protocol = ["tauri/custom-protocol"]`，`docs/design/terminal-next/release-engineering-report.md` §1 记为「已定位并修复」。**不把该调查中的旧风险标成当前未修复问题** |

---

## 14. 门禁（本地实跑）

| 门禁 | 结果 |
| --- | --- |
| 前端测试 | **250 文件 / 2276 项全绿**（基线 246/2225） |
| typecheck | 通过 |
| ESLint | 通过 |
| source-size | 684 生产文件通过 |
| bundle budget | 626.24 / 628.00 KB 通过 |
| 证据门禁 | **FAIL** — §12，预期内 |

---

## 15. 过程记录：自己引入又修掉的三处

1. **测试没锁住变异**。`use-upload-completion-refresh` 的第一版单测在断言前没推进
   定时器，把 `queued` 当成落地的变异**全绿通过**。补 `vi.advanceTimersByTime` 后才红。
   与 Phase 10.4.1「变异回 `retryable` 后 8/8 仍绿」是同一形态。
2. **`forgetSession` 用错在两条路径上**。最初在「立即关闭」和「取消释放」两条路径
   都调它，前者抹掉了 `closing` 标记，导致关闭后的 session 还能接受新传输。
   拆成 `cancelDeferredRelease`（只停表）与 `abandonDeferredRelease`（停表 + 清标记）。
3. **测试里 mock 了被测函数**。`sftp-compact-dock.test.tsx` 第一版 mock 掉了
   `pansNeedSingleColumn` 本身，等于让断言测 mock。改为 stub `ResizeObserver`，
   真实实现参与，随后变异才真正被抓到（6 项失败）。
