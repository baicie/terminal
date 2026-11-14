# TN-SFTP 三个 PR — 独立审查

- 角色：独立审查者（未参与实现本轮的 PR 内容评审部分）
- 日期：2026-11-14
- 审查方式：读取 GitHub 当前实际 head 的完整 diff，不采信交付报告
- **未修改任何代码、未提交、未更新分支、未合并、未关闭 PR、未删除 worktree、未覆盖证据**

审查基线（GitHub 实际 head）：

| PR | head SHA | base | mergeable | 状态 |
| --- | --- | --- | --- | --- |
| #47 | `3281fafbb1b5bc9e67e37c113df775b0a8c9eed6` | `main` | MERGEABLE | Ready（11:32:40Z 由用户从 Draft 转出，非本 Agent 操作） |
| #48 | `1e88a88c2c72c106696b64def799ec7a2a7c9caf` | `feat/tn-sftp-01-session-claim` | MERGEABLE | Ready（同上，11:32:40Z） |
| #49 | `c147f0987cf53ccc073fe2d3f8e3ce4c29369113` | `feat/tn-sftp-02-compact-dock` | MERGEABLE | Ready（同上，11:32:41Z） |

---

## 0. 裁决

| PR | 裁决 |
| --- | --- |
| #47 | **REQUEST CHANGES** |
| #48 | **APPROVE** |
| #49 | **APPROVE** |

阻断项只有一个，在 #47：`sftp-session-claim.ts` 的 `sessions` Map 无界增长。
其余为 P1/P2，不阻断合并但应在后续修复。

---

## 1. P0 / P1 / P2 / P3 问题清单

### P0 — 无

### P1-1：`sessions` Map 无界增长（#47）

**文件**：`packages/frontend/src/service/sftp-session-claim.ts:126-137`（`beginSessionClose`）

**实际代码行为**：

```ts
export function beginSessionClose(sessionId: string): boolean {
  const entry = sessions.get(sessionId)
  if (!entry) {
    // Nothing claimed it: record the closing state anyway
    sessions.set(sessionId, { tokens: new Set(), closing: true })
    return true
  }
  entry.closing = true
  return entry.tokens.size === 0
}
```

关闭路径上**没有任何地方删除这条记录**：

- `forgetSession()` 只在 `abandonDeferredRelease()` 里调用，而后者**无任何调用方**（见 P2-1）；
- `releaseToken()` 在 `tokens.size === 0 && !closing` 时才 delete，而 `closing` 恒为 true；
- 定时器关闭连接后也不清。

**触发条件**：每一次 Dock 关闭 / 主机切换 / 组件卸载，都会为一个此前无 Claim 的
`sessionId` 创建一条永久记录。

**实测**（`/tmp/probe-closing.mjs`，直接复刻该逻辑）：

```
1000 次 Dock 开关 → sessions.size = 1000
```

**用户影响**：单条约 300 B（key 字符串 + Map 条目 + 空 Set + 对象）。
1000 次开关约 300 KB，10000 次约 3 MB。长会话的日用终端会持续累积，
直到进程退出。不是崩溃级问题，但这是**单调增长**，且没有任何上限或回收。

**复现方法**：

```js
// 复刻 beginSessionClose 与 releaseToken，循环 1000 次不同 id
for (let i = 0; i < 1000; i++) beginSessionClose(`ssh-${i}`)
sessions.size // 1000
```

**为什么没有造成功能故障**：后端 `src-tauri/src/session/ssh.rs:1606` 每次连接生成
`format!("ssh-{}", uuid::Uuid::new_v4())`，id 永不复用。所以残留的 `closing=true`
永远不会挡住真实的新连接——**这一点我专门核实过，不是推测**。

**修复建议**：关闭完成后调 `forgetSession(sessionId)`。即在
`sftp-deferred-release.ts` 的两个关闭点（立即关闭分支 `:54`、定时器分支 `:72`）
各加一行。测试 `a completed close keeps refusing claims for that id`
（`sftp-session-claim.test.ts:175`）需要相应改写——它目前把残留固化成了契约，
注释理由是「ids are not reused」，这个理由成立，但不构成保留无界增长的理由。

**是否阻断合并**：**是**。理由：这是新引入的、单调增长的状态，修复只需两行，
且现在改比合并后改再触发一轮证据重采便宜。

### P2-1：`abandonDeferredRelease` 是死代码（#47）

**文件**：`packages/frontend/src/view/sftp/hooks/sftp-deferred-release.ts:110`

全仓搜索确认无任何调用方（`grep -rn abandonDeferredRelease packages/frontend/src`
只命中定义处与内部 `forgetSession` 调用）。它自己的注释也承认：
「Today the hook does not call either」。

**影响**：一个带详细文档的导出函数无人使用，读者会以为存在「取消延迟释放」路径，
实际不存在。且它是 P1-1 唯一可能的清理由口——留在那里但不接线，等于把修复路径
写成注释而不是代码。

**建议**：接线到「主机切回同一 session」的分支，或删除。**不阻断合并**。

### P2-2：`closing` 标记挡住了同一 session 的合法后续传输（#47）

**文件**：`sftp-session-claim.ts:132` + `sftp-transfer.ts:76-80`

一个 session 已有 Claim 时关闭 Dock → `beginSessionClose` 置 `closing=true` 并返回
`false`（延迟）→ Claim 释放 → 定时器关连接。此时该 id 永久不可用。

实测（`/tmp/probe-reject.mjs`）：

```
1. claim: true
2. beginClose with live claim -> false (defer, correct)
3. after release, closing flag still set? true
4. new claim on same id: false (refused)
```

**为什么不是 P1**：id 永不复用（见上），所以这条路径在真实运行中不可达。
**但**它是 P1-1 的同一个根因，且 `sftp-deferred-release.ts:76-80` 的注释
「A session left marked closing refuses every future transfer without any visible
reason」描述的正是这个状态——注释承认了风险，代码没有消除它。

**建议**：与 P1-1 同修。**不阻断合并**（不可达），但应在同一 commit 解决。

### P2-3：`closing` 与队列判定的顺序存在理论窗口（#47）

**文件**：`sftp-dock-close-race.test.ts` 覆盖了，但有一处不一致

`releaseOrDefer` 先 `beginSessionClose()` 再 `isBusy()`。若 `isBusy()` 用的是
**队列单源**谓词（`hasTransfersForSession` 而非 `isSessionBusy`），一个刚
`scheduleTransfer()` 完、Claim 已释放、但 store 更新尚未落定的瞬间，
`claimIdle` 为 true 而 `isBusy` 为 false → 立即关闭一个刚入队的传输。

**当前不可达**：唯一生产调用点 `use-sftp-remote.ts:85` 传的是 `isSessionBusy`
（含 claim + 队列）。且 `scheduleTransfer()` 是同步写 store，与 `claim.release()`
之间没有 await。

**建议**：把 `hasClaimsForSession` 与队列检查都内建进 `releaseOrDefer`，
让谓词参数只作为补充而非唯一队列来源。**不阻断合并**（不可达）。

### P3-1：`sftp-transfer.ts` 的 import/export 冗余（#47）

`currentRuntime` 与 `recordBlockedTransfer` 既被 `import` 又在 `export {...} from`
里重复出现（`sftp-transfer.ts:12-16` 与 `:44-46`）。TS 合法，打包器会处理，
但读者会疑惑哪个是权威。**不阻断**。

### P3-2：`mock` 与真实阈值重复定义（#48）

`sftp-compact-dock.test.tsx` 里 mock 了 `pansNeedSingleColumn`，
把 520 阈值复制了一份。若实现改了阈值而测试没改，测试仍绿。
注释说「duplicated here deliberately, so the mock cannot hide a change to the real
rule」——但复制常量恰恰**会**隐藏变更。**不阻断**，建议改为只 stub
`ResizeObserver`（当前实现已经是这样，此 mock 是残留）。

---

## 2. PR #47 — Session Claim 逐项

| # | 检查项 | 结论 | 证据 |
| --- | --- | --- | --- |
| 1 | Claim 在第一个 await 之前 | **PASS** | `sftp-transfer.ts:69` `claimSession()` 是 `startTransfer` 第一行；模块全同步 |
| 2 | Dialog 之前是否已取得 Claim | **PASS（设计如此：不取）** | `use-sftp-transfer-actions.ts` 对话框期间不 claim，理由正当：用户未承诺传输 |
| 3 | 拖拽/批量/直接 API 覆盖 | **PASS** | 三条路径都汇聚到 `startTransfer()`；`useSftpDrop → uploadPaths → uploadFile` |
| 4 | Host Switch / Dock Close 调用顺序 | **PASS** | 两者同走 `releaseSessionUnlessBusy → releaseOrDefer`，先 `beginSessionClose` 后 `isBusy` |
| 5 | closing 是否永久残留 | **FAIL → P1-1** | 见上 |
| 6 | Claim 可能重复释放 | **PASS** | `released` 布尔 + token Set 双保险 |
| 7 | `forgetSession` 会删有 Claim 的 Session | **PASS（但函数无生产调用方）** | `forgetSession` 无守卫，会无条件 `delete`；但当前无生产调用方，仅 `abandonDeferredRelease` 调用，而后者是死代码（P2-1） |
| 8 | 延迟定时器重新检查 Claim | **PASS** | `sftp-deferred-release.ts:74` `hasClaimsForSession(sessionId) \|\| isBusy(sessionId)` |
| 9 | Claim 与 Queue 之间空窗 | **PASS** | 先 `scheduleTransfer()` 后 `claim.release()`，瞬间并存 |
| 10 | 多并发 Claim 资源泄漏 | **PASS** | Set 引用计数，100 项测试通过 |
| 11 | `prepareChannel` 失败释放 | **PASS** | 单一 `finally`；有测试 |
| 12 | `listenerPromise` 缓存污染 | **PASS（有测试隔离需求）** | 实现本身幂等；测试必须 `__resetProgressListenerForTests()`——我写测试时踩过，已修 |
| 13 | done 事件与 Promise resolve 重复 | **PASS** | `completeTransfer` 幂等：`transition` 检查 `canTransition`，`done` 无后继 |
| 14 | Rust 错误/前端异常/卸载收口 | **PASS** | `Promise.resolve().then().then(onOk, onFail)` 覆盖同步抛错 |

### 状态机对照

**`OPEN → CLAIMED → QUEUED → RUNNING → COMPLETED → RELEASED`**
`claimSession` → `scheduleTransfer` → `pump` 同步占槽 → `completeTransfer` → `claim.release()`（在 finally 中，早于此）。
**RELEASED 实际先于 COMPLETED**（claim 在 `scheduleTransfer` 后立即释放，传输还在队列里）。
这是**正确**的——归属已由队列记录接管。不是丢失状态。

**`OPEN → CLAIMED → CANCELLED → RELEASED`**
`provider` 的 `abort` 路径未在本 PR 覆盖（传输尚未入队时用户无取消入口）。
Claim 仍由 `finally` 释放。**无非法转换**。

**`OPEN → CLAIMED → PREPARE_FAILED → RELEASED`**
`prepareChannel` 返回 false → `return` 走 `finally` → release + `recordBlockedTransfer`
写一条 error 记录。**正确**。

**`OPEN → CLOSING → DEFERRED → IDLE → CLOSED`**
`beginSessionClose` → `deferredReleases.set` → 定时器见 idle → `close`。
**CLOSED 后无清理**（P1-1）。这是唯一的非法终止：状态机停在 CLOSED 而非回到
「无记录」。

### 未验证项

- **`NOT_VERIFIED`**：真实 Tauri 运行时下 Tauri IPC 的实际时序。所有证据来自
  jsdom + 可控 Promise。`prepareChannel` 的真实往返耗时、真实 `sftp-progress`
  事件的到达顺序，均未在真实应用中观察。

---

## 3. PR #47 — 上传完成刷新

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| 严格以真正成功为条件 | **PASS** | `record.status !== 'done'` 直接 return（`use-upload-completion-refresh.ts:120`） |
| 批量按 Session + RemoteDir 合并 | **PASS** | `record.sessionId !== current.sessionId` + `remoteDirOf(record.remotePath) !== current.remoteDir` |
| done 与 resolve 重复触发 | **PASS** | `settled: Set<string>` + `seen: Map<id, status>` 双层 |
| 失败是否错误刷新 | **PASS** | `error`/`cancelled` 不满足 `=== 'done'` |
| 取消是否显示成功 | **PASS** | 同上；且本模块不产生任何 toast |
| Host 切换后刷旧 Host | **PASS** | target 变更清 `settled` 并取消定时器；触发前再比一次 |
| 卸载后状态更新 | **PASS** | `disposed` 标志 + `clearTimeout` |
| 快速连续上传丢通知 | **PASS（有代价）** | 250ms 合并窗口；若两批间隔 < 250ms 会合并为一次。这是**有意**的（同目录重复列目录代价更高） |

**观察**：250ms 合并窗口意味着「上传完成」到「列表更新」最多延迟 250ms。对
真实用户无感，但它是一个**未在任何文档里声明的可感知延迟**。P3 级。

---

## 4. PR #48 — Compact Dock

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| `ResizeObserver` 生命周期 | **PASS** | `useEffect(..., [])` + `observer.disconnect()`（`:49`） |
| 容器宽度变化布局稳定 | **PASS** | 只在 `width` 变化时 setState；单/双栏由纯函数决定 |
| 首次测量前默认布局 | **PASS** | `width === null → single`（安全默认，无闪烁） |
| 300px Dock 真实可用宽度 | **NOT_VERIFIED** | 未在真实 WebView 中测量。520px 阈值是推算（两栏各 ~230px），非实测 |
| Local/Remote 切换与 Host Pin | **PASS** | `mobilePane` 已改为默认 `remote`；`useSftpBoundHost` 未改 |
| TransferPanel 是否溢出 | **PASS（静态）** | `max-w-[calc(100%-1rem)]`；真实渲染未验证 |
| 文件名 Tooltip 与键盘 | **PASS** | `title={file.name}`、`tabIndex=0`、`focus-visible:opacity-100`、`aria-label` |
| 多语言 key 完整 | **PASS** | 三语各 1 处 `sftp.fileActions`；`parity.test.ts` 通过 |
| 视图切换是否重挂 PTY | **PASS（未触碰）** | 改动全在 `view/sftp/**`，无终端容器文件 |
| 是否破坏 #44 chooseLayout | **PASS** | 三 PR 对 `layout/` 零改动（独立核实） |

### 边界情况

| 边界 | 行为 | 结论 |
| --- | --- | --- |
| `ResizeObserver` 不可用 | fallback 到 `window.resize` + `getBoundingClientRect` | **PASS** |
| 容器尺寸为 0 | `next > 0` 守卫，保留旧值 | **PASS**（实测：隐藏期间保留 300，恢复后更新为 1400） |
| 连续 resize | 每次 setState，React 批处理 | **PASS** |
| 组件卸载 | `disconnect()` | **PASS** |
| 挂载即隐藏 | `width` 保持 null → 单栏 | **PASS**（安全默认） |

**未验证**：`NOT_VERIFIED` — 真实 Tauri WebView 中 300px Dock 的实际渲染宽度、
`truncate` 的实际截断位置、`TransferPanel` 在 Dock 中的真实边界。

---

## 5. PR #49 — E2E

| 检查项 | 结论 | 证据 |
| --- | --- | --- |
| 24 MiB 真实经过子系统 | **PASS** | `enableSftp: true`；`stderr` 断言不含 `subsystem request failed`；实测 805ms |
| 上传下载都是真实 SSH | **PASS** | 真实 `/usr/bin/sftp` + 真实 sshd + 真实密钥 |
| SHA-256 由独立文件内容计算 | **PASS** | `sha256(await readFile(payload))` / `sha256(uploaded)` / `sha256(await readFile(returned))`——三次都是 `readFile` 后的 Buffer |
| 真实 sshd | **PASS** | `startTerminalSmokeSshd` |
| 是否存在 skip / 条件跳过 | **有平台门** | `SUPPORTED = darwin \|\| linux`；Windows 上 `describe.skip` |
| 是否仅 mock | **PASS** | 无 mock |
| 替换无残留 | **PASS（但与 #43 重复）** | 文件头已如实标注 |
| 失败时清理 fixture | **PASS** | `afterAll` 中 `sshd?.stop()` + `rm`，均 `.catch()` |

### 三层区分

| 层级 | 判定 |
| --- | --- |
| SFTP CLI fixture E2E | **PASS** |
| Rust command-level E2E | **NOT_RUN** — 未调用 `sftp_upload`/`sftp_download` |
| 真实 Tauri GUI 产品 E2E | **NOT_RUN** |

### 关键核实：这个测试在 CI 里真的跑吗

`vitest.config.ts` 的 `include: ['src/**/*.test.{ts,tsx}']` — `.e2e.test.ts` 匹配该 glob。

实测 `npx vitest list` 收集到 5 项。

**CI 实际执行证据**（PR #47 的 Frontend quality job `132422571326`）：

```
✓ src/features/sftp/sftp-subsystem-live.e2e.test.ts (3 tests) 814ms
Test Files  248 passed (248)
Tests       2258 passed (2258)
```

在 `ubuntu-latest` 上真实执行，非 skip。这证明 macOS/Linux runner 的 sshd fixture
可用——但**不证明** PR #49 那条 24 MiB 在 CI 跑过（那是 PR #49 自己的 run，
当时仍在进行中）。**`NOT_VERIFIED`**：PR #49 的 CI 实测结果。

### 一个诚实性问题

`SUPPORTED` 排除了 Windows，而 `ci.yml` 的 `Frontend quality` 跑在
`ubuntu-latest`。所以这条测试**不会**在 Windows 上跑，也不会因此报错——
`describe.skip` 是静默的。若期望 Windows 覆盖，需要单独说明；目前的
「5 passed」在没有 Windows 的地方读到会让人误以为三平台都过了。P3。

---

## 6. PR 依赖关系

| 检查项 | #47 | #48 | #49 |
| --- | --- | --- | --- |
| base | `main` | `feat/tn-sftp-01-...` | `feat/tn-sftp-02-...` |
| head | `3281faf` | `1e88a88` | `c147f09` |
| mergeable | MERGEABLE | MERGEABLE | MERGEABLE |
| 提交数 | 1 | 1 | 2 |

**重复提交**：无。三个 PR 的 commit SHA 互不相同，没有交叉包含。

**交叉覆盖**：`#47` 与 `#48` 只在 `sftp-container.tsx` 有一行交集
（`mobilePane` 默认值 `'local' → 'remote'`）。`#49` 只新增文件，不改任何既有代码。

**#47 合并后 #48 是否成立**：**成立**。`#48` 不 import 任何 `#47` 新增模块
（`sftp-session-claim` / `sftp-transfer-channel` / `use-upload-completion-refresh` /
`use-sftp-transfer-actions`）。实测 `git merge-tree` 将 `#48` 直接合到 `main`：
**0 conflicts**。

**#48 合并后 #49 是否成立**：**成立**。`#49` 是纯新增（2 文件，+589/-0）。

**结论**：这是**真正的正交切分**，不是重复实现。stacked 依赖只是提交顺序，
不是逻辑依赖。`#48` 可以脱离 `#47` 独立合入。

---

## 7. 证据门禁

### 追查结果

| 问题 | 答案 |
| --- | --- |
| `FINGERPRINT_PATHS` 是什么 | `scripts/check-verification-evidence.mjs:307`，24 条路径，第一条 `packages/frontend/src` |
| 指纹生成逻辑 | `computeSourceFingerprint()`：收集所有文件 → 排序 → 逐个 `hash.update(路径)` + `hash.update(内容)` → SHA-256 |
| 是否绑定 Git SHA | **否**。纯内容哈希，与 commit SHA、分支、时间无关 |
| 证据重采规则 | `docs/release/workflow-rules.md` §1：冻结源码 → 派发 macOS evidence job → 下载产物 → 过门禁。顺序不可颠倒 |
| merge 前后证据有效性 | **只与文件内容相关**。rebase / squash / 换分支都不影响指纹 |
| 是否允许 PR 阶段重采 | **技术上允许**（`workflow_dispatch` 可指定任意 ref），但**不经济** |

### 实测

```
指纹 d45be8132fe1… → 本地 f4e9684d85bc…（PR#49 head）
                  → CI 3d8d88bb0ad1…（PR#47 head）
```

**三个 PR 的指纹互不相同**，也都不等于已入库证据的 `d45be8132fe1…`。

### 判断：应每个 PR 重采，还是最终合并后统一重采

**统一重采**，理由有三：

1. 指纹是内容哈希 → 每次合并后内容再变，先前采的全部作废。stacked PR 逐个重采
   等于采三次、废两次。
2. `workflow-rules.md` 的顺序要求「先冻结源码」，而 stacked PR 的源码在合并过程中
   会持续变化，不满足冻结条件。
3. 三 PR 的 diff 都是 `packages/frontend/src/**`，合并后一次性重采可覆盖全部。

**唯一例外**：若某个 PR 要单独合入（不随另外两个），它必须自己重采。

### 当前 CI 状态

三个 PR 的 `Repository gates` 全红，**唯一失败步骤**是
`Verification evidence matches this checkout`（7 项指纹不匹配）。
`Run pnpm check:source-size` 在同一 job 里是**绿的**（682 files passed）。

**这是预期内且不可在 PR 阶段回避的**：任何改 `packages/frontend/src/**` 的 PR
都会红这一步。**不构成对代码质量的否定**，但也不应被说成「CI 全绿」。

---

## 8. 未验证项汇总

| 项 | 状态 |
| --- | --- |
| 真实 Tauri WebView 中的 Dock 300px 实际渲染 | **NOT_VERIFIED** |
| 真实 Tauri 运行时 Tauri IPC 时序 | **NOT_VERIFIED** |
| 文件名的实际截断位置 | **NOT_VERIFIED** |
| `TransferPanel` 在 Dock 中的真实边界 | **NOT_VERIFIED** |
| PR #49 的 CI 实测结果（审查时 run 未完成） | **NOT_VERIFIED** |
| Windows 上的 SFTP 行为 | **NOT_VERIFIED**（`describe.skip` 静默跳过） |
| Rust command-level SFTP E2E | **NOT_RUN** |
| 真实 Tauri GUI 产品 E2E | **NOT_RUN** |

---

## 9. 最终裁决

### PR #47 — **REQUEST CHANGES**

阻断项：**P1-1**（`sessions` Map 无界增长）。修复需在
`sftp-deferred-release.ts` 的两个关闭点各加 `forgetSession(sessionId)`，并改写
`sftp-session-claim.test.ts:175` 那条把残留固化成契约的测试。

其余（P2-1 死代码、P2-2 不可达的误拒、P2-3 理论窗口、P3-1 冗余 import）
不阻断，但建议同 commit 一并处理。

核心机制本身是正确的：Claim 同步取得、令牌幂等释放、定时器内建 Claim 检查、
入队与释放顺序无空窗——这四条我都逐行核实过。

### PR #48 — **APPROVE**

未触碰 `layout/`，#44 的 `chooseLayout` / `withHysteresis` 完整保留。
容器的三类边界（RO 缺失、宽度 0、卸载）都有正确处理，我实测了宽度 0 的行为。
可脱离 #47 独立合入（`git merge-tree` 0 conflict）。

保留意见：P3-2 的 mock 重复定义阈值；520px 阈值是推算而非实测。

### PR #49 — **APPROVE**

真实 sshd、真实 `sftp` 二进制、三次 `readFile` 后的 SHA-256 比对、失败清理完整。
文件头如实标注了与 #43 重复的那一条，没有包装成增量。

保留意见：Windows 静默跳过；PR #49 自身的 CI 结果审查时未出。

---

## 10. 关于「CI 全绿」

三个 PR 现在**都不是全绿**。`Repository gates` 在三个 PR 上都红，原因是证据指纹。
我**没有**因为它红就说代码有问题，也**没有**因为它只是证据问题就忽略——
它的处置方式（统一重采 vs 逐个重采）在 §7 有明确判断。
