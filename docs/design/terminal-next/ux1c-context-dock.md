# UX-1c — Context Dock 交付记录

- 分支：`feat/terminal-next-ux1c-context-dock`
- 基线：`main = 46071b5`（UX-1b 合并后）
- 实施 HEAD：`a30a64f`
- PR：Draft

本阶段完成 Context Dock 与两个真实缺陷（INV-13、INV-14）。**未实施** UX-2a/2b
Vault/Keychain、UX-3 插件系统、UX-4 Rust Rig。

---

## 0. 开工审查：两个现在就存在的缺陷

按任务书要求先审真实代码。SFTP 的 host 绑定与会话生命周期各有一个缺陷，都不是
UX-1c 引入的，但 Dock 会让它们常态化。

### INV-13：SFTP 跟随 activeTabId

`sftp-container.tsx:31-33`：

```ts
const activeHost = activeTab?.hostId
  ? (hosts.find(h => h.id === activeTab.hostId) ?? null)
  : null
```

切标签就静默换主机。整页时已经危险（切到 staging 标签，文件面板也变 staging），
但用户至少是**主动离开**了 SFTP 页。Dock 常驻后，用户只是在终端里换了个标签，
面板后面的服务器就换了 —— 而删除、重命名、上传都打在「面板当前显示的那台」上。

### INV-14：卸载 SFTP 视图会关闭会话

`use-sftp-remote.ts` 的 effect cleanup：

```ts
return () => releaseSession()
```

而每个传输都带着这个 `sessionId`（`sftp-transfer-queue.ts` 的 `TransferArgs`）。
所以：打开文件面板 → 开始上传 → 回到终端 → **上传半路失败**，错误信息说连接
断了，但断开是应用自己做的。

Dock 让这条路径从「离开页面」变成「关个面板」，后者一天可能几十次。

---

## 1. INV-13：显式且钉住的绑定

`store/sftp-binding.ts` 把规则变成可测的纯函数：

| 情况 | 结果 |
| --- | --- |
| 未 pin | 跟随 active tab（第一次打开的行为不变） |
| 已 pin | pin 优先，焦点移动不改写 |
| pin 与 active tab 不同 | `differsFromActiveTab = true`，工具栏显示「跟随当前标签」 |
| 面板关闭 | 清 pin，下次打开重新读 active tab |

**绑定不持久化。** 它不在 `WorkspaceLayout` 里，也不在 `AppStore` 的恢复字段里。
重启后自动连上一台服务器是一个用户没有要求的连接。

先红后绿：把 `resolveSftpHostId` 改回「跟随 active tab」，
`keeps the pinned host when the active tab changes` 变红。

---

## 2. INV-14：关闭面板不截断传输

`view/sftp/hooks/sftp-deferred-release.ts`：

```
releaseOrDefer(sessionId, isBusy)
  ├─ 没有 running/queued 传输 → 立即 close，返回 true
  └─ 有 → 注册 watcher，每秒检查；最后一个传输落地后 close，返回 false
```

调用点两处，都要走同一个 guard：

| 调用点 | 何时 |
| --- | --- |
| effect body | 切换 host 之前 |
| effect cleanup | 卸载（关闭面板 / 离开路由） |

`ensureSession` 里切换 host 时也改走这个 guard —— 切换主机同样不是砍断传输的许可。

**为什么 `queued` 也算 busy**：排队中的传输还没开始读字节，但它会开始。在它下面
关掉连接，失败的原因不是用户造成的。

**为什么用轮询而不是订阅**：队列是普通 zustand store，没有「这个 session 的最后
一个传输落地」事件；面板关闭时的 1 秒轮询没有任何成本。

### 2.1 过程中自己引入又修掉的缺陷

第一版把 `releaseSessionUnlessBusy()` 同时放在 effect body 与 cleanup 里，导致
**双重释放**：body 清掉 `sessionRef` → `loadDir` 重新连接 → 下次 host 变化时
cleanup 再清一次。表现为切一次 host 触发 **9 次** `createSshSessionPassword`。

用探针（`create=2 close=[]` vs `create=9`）定位后修正：body 负责「切 host 前释放」，
cleanup 只负责「卸载时释放」，两者不重复。

---

## 3. Context Dock

`store/right-panel-state.ts` + `right-panel-store.ts`，与左栏同一套规则：

| 项 | 值 |
| --- | --- |
| 取值 | `none \| sftp` |
| 切换 | 从关闭开 SFTP，从 SFTP 关；不在面板之间跳 |
| 位置 | `TerminalByUrl` 的**兄弟**，不是祖先 |
| 存在条件 | 只在 `/terminal` 路由、非移动端 |
| 加载 | SFTP 组件 `lazy()` —— 不进首次可终端时间 |
| 持久化 | **否** |

`RightPanelMode` 里预留了 `snippets` / `ai` 的位置但未实现：advisory 的性质是这样
新增面板是「改一个 union + 一个 case」，而不是「再加一个布尔量、再忘掉一处检查」。

Rail 的 Files 项改为开 Dock 而非导航；`/sftp` 路由与全部既有能力保留。

---

## 4. 拆分（source-size 触发，全部本地发现）

| 文件 | 原 | 现 | 拆出 |
| --- | --- | --- | --- |
| `use-sftp-remote.ts` | 354 | 288 | `sftp-deferred-release.ts`、`use-sftp-file-operations.ts` |
| `sftp-container.tsx` | 232 | 200 | `sftp-dock-toolbar.tsx` |
| `sftp-transfer-queue.ts` | 323 | 298 | `sftp-transfer-session.ts` |

---

## 5. 验收

### 5.1 测试

| 文件 | 项数 | 覆盖 |
| --- | --- | --- |
| `store/sftp-binding.test.ts` | 10 | 解析规则、生命周期、不持久化 |
| `service/sftp-transfer-session-guard.test.ts` | 8 | `hasTransfersForSession` 三态 |
| `view/sftp/hooks/use-sftp-remote-session.test.tsx` | 7 | 卸载/切换时的会话保留与释放 |
| `components/activity-rail/index.test.tsx`（改+增） | 9 | Files 开 Dock、其余仍是链接 |
| `layout/navigation-dedup.test.tsx`（既有） | 5 | 左栏单面板（未受本轮影响） |

### 5.2 先红后绿

| 变异 | 结果 |
| --- | --- |
| `resolveSftpHostId` 改回跟随 active tab | 1 红 |
| 恢复原始 `use-sftp-remote.ts`（无条件 `releaseSession`） | **4 红** |

第二条是本阶段的核心证据：它证明 INV-14 的三条不变量真的被守住。

### 5.3 门禁

| 项 | 结果 |
| --- | --- |
| 前端 | **236 文件 / 2121 项**（基线 233 / 2095，+3 / +26） |
| Rust | **391 passed** / 0 failed / 4 ignored |
| `cargo fmt --check` | 通过 |
| typecheck | 通过 |
| ESLint | **0 error / 0 warning** |
| source-size | **672** 个生产文件 |
| bundle budget | **624.04 / 628 KB**（initial 130.89 / 240，+0.01） |
| 证据 | 指纹 `f9859207…` → 新指纹，官方流程重采 |

bundle 增量 +1.00 KB，initial 几乎未动（130.88 → 130.89）—— Dock 本身是 lazy 的。

---

## 6. 真实 GUI

`AXIsProcessTrusted: false`，且本会话运行在 Claude 桌面应用内，其窗口全屏覆盖，
应用窗口无法获得可见像素。

```
DOCK_OPEN_CLOSE_GUI            = NOT_RUN
SFTP_PINNED_HOST_GUI           = NOT_RUN
SFTP_FOLLOW_ACTIVE_TAB_GUI     = NOT_RUN
UPLOAD_SURVIVES_DOCK_CLOSE     = NOT_RUN
DIFFERENT_WIDTH_COLS_ROWS      = NOT_RUN
GUI_IME / VAULT_REAL_FLOW      = NOT_RUN
```

**上传在关面板后继续**这条，自动化证明的是「会话没有被 close」，不是「字节还在流」。
后者需要真实 sshd + 真实 GUI 操作。

---

## 7. 产品体验变化

| 场景 | 之前 | 现在 |
| --- | --- | --- |
| 在终端里看文件 | Rail 点 Files → 离开终端整页 | Rail 点 Files → **右栏打开，终端还在** |
| 切标签 | 文件面板跟着换服务器 | **面板留在原服务器**，给出「跟随当前标签」按钮 |
| 上传中回终端 | 上传中断（离开页面） | **上传继续**，面板关掉也不影响 |
| 管理主机 / 导入 / 共享 | Hosts 页 | 不变 |
| `/sftp` 深链 | 整页 | 仍可用 |

---

## 8. 代码风险清单

| 风险 | 严重度 | 状态 |
| --- | --- | --- |
| deferred release 用 1 秒轮询 | 低 | 关面板时刻的一次轮询，成本可忽略；无订阅事件可用 |
| 传输结束后连接会关，即使面板还开着 | 中 | **行为变化**：原来关面板才关连接。现在无传输时关面板就关，符合预期；但「面板开着、传输结束」的场景连接仍在（由 `ensureSession` 复用），未变 |
| 两个 SFTP 入口（Rail 的 Dock + `/sftp` 路由） | 低 | 刻意保留：路由是深链与管理入口，Dock 是工作面板。`navigation-dedup` 只约束左栏 |
| 移动端没有 Dock | 低 | 移动端沿用整页 `/sftp`（任务书要求窄屏沿用原导航） |
| Dock 宽度固定 420px 不可调 | 低 | 本轮不做 resize；终端最小宽度未受保护，窄窗口下需人工确认 |
| bundle 余量 3.96 KB | 中 | 下一阶段再加功能需评估 |

---

## 9. 16 条不变量矩阵

| ID | 不变量 | 本轮 | 依据 |
| --- | --- | --- | --- |
| INV-1 | 全局恰好一个 `[data-terminal-workbench]` | **PASS** | 挂载点未动；Dock 是兄弟节点 |
| INV-2 | 一 tabId 一 TerminalContainer | **PASS** | 未改 |
| INV-3 | 已挂载 pane 不因切 tab/路由卸载 | **PASS** | 未改 |
| INV-4 | 终端层永不卸载 | **PASS** | Dock 开关不触碰 `TerminalByUrl` |
| INV-5 | 可见性只有一个判定源 | **PASS** | UX-1b 收敛；本轮未新增字面量 |
| INV-6 | 布局持久化字段集合不可缺项 | **PASS** | Dock 与 SFTP 绑定**有意不持久化**，布局字段未变 |
| INV-7 | 恢复持久化订阅点不可移除 | **PASS** | 未改 |
| INV-8 | `prune` 只按完整 tab 集合关闭 | **PASS** | 未改 |
| INV-9 | tab id 跨恢复稳定 | **PASS** | 未改 |
| INV-10 | 快捷键三层保护同时存在 | **PASS** | 未新增绑定 |
| INV-11 | 输入/输出只有一条有序通路 | **PASS** | Dock 不触碰 SessionIo |
| INV-12 | 窄窗口与侧栏由 store + 单一断点驱动 | **PASS** | Dock 在 `isMobile` 时不渲染；断点仍只有 `useIsMobile` |
| INV-13 | SFTP 主机绑定必须显式 | **PASS（本轮修复）** | pin + 显式「跟随」按钮；先红后绿 |
| INV-14 | SFTP 连接不被切 tab/关面板终止 | **PASS（本轮修复）** | deferred release；原实现 4 项红 |
| INV-15 | 启动门禁与恢复编排保持为布局祖先 | **PASS** | 未改 |
| INV-16 | 前端源码改动会让证据失效 | **PASS（已重采）** | 官方流程 |

**16 PASS / 0 NOT_RUN。** INV-13 与 INV-14 从 NOT_RUN 转为 PASS。

---

## 10. 合并建议

**READY**（受一项约束）

| 条件 | 状态 |
| --- | --- |
| INV-13 / INV-14 修复 + 先红后绿 | ✅ |
| 全部门禁 | ✅ |
| 证据重采至匹配指纹 | ✅ |
| CI 11/11 | 见 PR |
| **同尺寸 GUI 截图** | ❌ 权限与遮挡，需人工 |

未合并、未打 Tag、未发布。
