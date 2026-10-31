# Phase 8 · P8.6 UI/UX 打磨

> 提交 `32fd7a0`。本轮只做「能说出修的是哪个可验证问题」的改动，不做主观审美重排。

## 1. 修复清单（10 项，12 个文件）

### 状态造假（最严重的一类）

| # | 位置 | 问题 |
| --- | --- | --- |
| 1 | `port-forward/index.tsx` | `handleStartCard` **完全不调后端**就把卡片置 `active:true` 并提示 started |
| 2 | 同上 | `portForwardStop` 返回 `success:false` 时只 `console.warn`，仍置 `active:false` + `toast.success` |
| 3 | 同上 | 无 SSH 会话时跳过后端，却持久化 `enabled:1` + `active:true` + 成功提示 |

三处都是「界面告诉用户成功了，而实际上什么都没发生」。已全部改为**以真实后端结果为准**：仅 backend success 才变更状态；无会话时写 `enabled:0/active:false` 并给出 `savedNotStarted` 警告。

### 危险操作

| # | 位置 | 问题 |
| --- | --- | --- |
| 4 | `hosts/host-card.tsx` | 删除主机**零确认**，且 `deleteHost` 失败也提示成功——原代码把「删除」按钮文案 `t('common.delete')` 当成了成功提示 |
| 5 | `port-forward/index.tsx` | 删除转发规则无确认、无后果说明 |

删除主机现走确认框，明确写出后果：已保存的凭据、分组归属、收藏会一并永久移除，不可撤销。**仅 `deleteHost` resolve 后才提示成功**；失败提示失败。

### a11y

- 主机卡片 `MoreHorizontal` 纯图标触发器补 `aria-label`/`title`（含主机名）
- `port-forward-card` 的 `Play`/`Square`/`Trash2` 三个纯图标按钮补可访问名称

### i18n 与偏好

- `port-forward` 整页 100% 硬编码英文，而 `portForwardView.*` 三语键**已存在却 0 引用** → 全部改用三语键，新增 22 个 key，en/fr/cn 完全对齐
- `animate-pulse` 改 `motion-safe:animate-pulse`（尊重 `prefers-reduced-motion`）
- 法语长文案溢出防护：`min-w-0` + `truncate`/`break-all` + `whitespace-nowrap`

## 2. 三条硬要求的核验结论

| 要求 | 结论 |
| --- | --- |
| SFTP 不得展示假的运行中取消成功 | **既有实现已正确，本轮未改**。`transfer-row.tsx` 运行中渲染 `disabled` 按钮 + 「后端没有取消命令」文案 + 「运行中无法取消」提示；只有 `queued` 可真取消 |
| 危险操作必须明确提示后果 | 主机删除、端口转发删除**已修**；**Vault 清空/覆盖导入未审**（文件预算用尽）——不能据此说它没问题 |
| SSH 连接状态必须真实可信 | `tab-connection-status` 六态由数据驱动、`connected` 无伪造分支，未发现「已连接但实际已断开」；端口转发侧两处伪造状态**已修** |

## 3. 测试

新增 8 条：图标按钮有可访问名称 / 菜单只「请求」删除不自己删 / 菜单→确认框集成 / 确认后才删并成功提示 / 存储失败报错不报成功 / 后端失败保持 Stopped / 后端成功才 Active / 停止失败保持 Active。

门禁：`typecheck` 0、`lint` 0、`vitest` **148 文件 / 1301 用例**（基线 1293，+8）、`check-source-size` **560 生产文件**通过。

## 4. 未修清单（诚实记录，不代表无问题）

文件预算 12 个已用满，以下**已定位但本轮未修**：

| 位置 | 问题 |
| --- | --- |
| `view/hosts/host-list-view.tsx:38` | 加载骨架 `animate-pulse` 无 `motion-safe:`；骨架无 `role="status"`/加载文案，读屏无法区分「加载中」与「真空」 |
| `view/port-forward/components/port-forward-toolbar.tsx` | 硬编码英文 + `animate-spin` 无 `motion-safe:` |
| `components/port-forward/port-forward-list-panel.tsx` | 整块硬编码英文；`title="Delete"` 的 icon-only 按钮无 `aria-label` |
| `components/settings-dialog/update-check.tsx` | 约 20 条英文硬编码，含 `FAILURE_COPY` 的 offline/timeout/unreachable/unconfigured/signature **全表**未 i18n |
| `features/terminal/.../terminal-pane-header.tsx`、`terminal-body.tsx` | `animate-pulse` 无 `motion-safe:`；`aria-label="Terminal"` 硬编码 |
| `custom-title-bar/index.tsx` | 大量 `bg-[#1e1e1e]`/`text-[#cccccc]` 硬编码色 + `aria-label` 硬编码 |
| `notification-panel/index.tsx:21-23`、`team-shared-section.tsx:85,100` | 语义 token 违规（`text-blue/green/yellow-500`、`text-amber-500`、`bg-amber-500/20`） |
| `file-pane-table.tsx:58`、`file-pane-navigation.tsx:79` | `animate-spin` 无 `motion-safe:` |
| `view/teams`、`view/settings`（除 update-check）、SFTP 双栏文件列表 | 只做 grep 级或抽样审查，**未逐文件深审** |

## 5. 一个需要决策的结构问题：`view/vaults/**` 是死代码

**已独立核实**：该目录下所有文件在 `router/index.tsx` 与 `app-sidebar/nav-config.tsx` 中**没有路由**，也没有任何来自目录外部的 import。

这与 P8.1 发现的 `use-vaults-container.ts` 死链是**同一类问题**——项目里有一整块看起来像活的、实际不可达的 Vault UI，且全部是英文硬编码。

改它零用户收益。**需要决策**：删除，还是重新接线到路由？这不属于 UI 打磨，不能在 UI 阶段顺手决定。

## 6. 诚实边界

本次是**抽样审查 + 定点修复**，不是全量 UI 审计。`view/teams`、`view/settings` 与 SFTP 文件列表只做了 grep 级扫描。没有截图对比（无法获取桌面截图），因此**任何视觉层面的"更好看"都没有被验证**——本轮能证明的只有：危险操作有确认、状态不再造假、图标按钮有可访问名称、文案进了 i18n、动画尊重 reduced-motion。
