# Overnight sprint checkpoint — 2026-11-08

- 当前时间（北京时间）：2026-11-08 00:42
- 分支：`feat/phase9-7-product-acceptance`（源码已冻结）
- 冻结 SHA：`9bad962`；证据矩阵 `42441960278` **3/3**，指纹 `4bbee997…`，门禁 0；Upgrade E2E `42444236952` 已派发（11:49）；CI `42444179936` 的 Repository gates 已 success
- PR #9：Open，**非 Draft**
- 硬截止：2026-11-08 12:00 +08:00

## 基线

- main：`3b23e8c`
- 本轮起点 HEAD：`892137c`（i18n 全量扫尾）
- 起点 CI：`Repository gates` 因旧证据与 `fr/app.ts` 301 行失败；其余 job 绿
- 证据矩阵 `42388505322`（`892137c`）已取消，源码未冻结前不重采

## P1 状态

- UI 截图：本机无 Accessibility/Screen Recording 权限，AppleScript 驱动被系统阻断；
  仓库未安装 Playwright。`UI_SCREENSHOT_EVIDENCE=NOT_RUN`（不伪造浏览器 mock 截图）。
- Settings 响应式：Tabs 改为 `grid-cols-3 sm:grid-cols-6`，窄屏两行。

## P2 审查结果（详见 docs/phase9-7/overnight-review-findings.md）

- 已修复：本地团队共享被云同步删除、敏感态冲突覆盖、DELETE push、resync 不完整清理、
  SFTP 会话泄漏、端口转发全双工死锁。
- 已记录未修：-R 远端转发未接线、SSH writer 超时竞态、协议 1 无游标首同步截断、
  teamApi 单例跨 endpoint、上传截断远端文件、SFTP mtime。

## 已完成的 P1

- [x] Settings：loading/ready/error 状态机、失败重试、未保存标记与离开回滚。
- [x] Hosts：loadHosts 失败显示错误与重试，中止/卸载保护，loadGroups 不再 unhandled。
- [x] Host Dialog：改用 shadcn Dialog（焦点/Esc/aria），未保存关闭需确认；表单逻辑拆到 hook。
- [x] Sidebar：分隔条支持 Arrow/Shift+Arrow/Home/End 键盘调整与 pointer 拖拽。

## 已完成的 P0

- [x] Team Sync 最低支持版本策略：毫秒时间戳游标在读取任何数据前返回
      426 CLIENT_UPGRADE_REQUIRED；旧客户端不能继续同步（A_TO_B=FAIL），但拒绝安全
      （本地 2 主机 + 1 snippet、服务端 share 集合不变），见 ADR。

- [x] 云团队创建改走真实服务端：`createCloudTeamWithSettings` 先在服务端创建/复用同名团队，
      再持久化服务端 id、成员与 settings；失败不提示成功；服务端成功而本地失败时返回
      `serverTeamId` 供重试采纳。5 项 action 测试 + 2 项对话框测试通过。

- [x] SFTP 会话绑定主机身份（hostKey + sessionRef），过期 generation 响应丢弃，
      切换主机立即 close 旧 session；双主机竞态测试旧实现 2/2 失败、新实现通过（f67f86c）。

- [x] `fr/en/cn` 的 `common.*` 键拆到 `locales/<lang>/common.ts`，`fr/app.ts` 301→263 行；
      `use-palette-static-results.tsx` 的快捷动作拆出；`sftp-container` 的三个对话框拆出。
      `check-source-size` 通过（582 文件）。

## 正在执行

- 等待证据矩阵与 Upgrade E2E；随后提交六份证据与最终 CI

## 下一步精确命令

```bash
cd packages/frontend && pnpm exec vitest run src/view/sftp
```

## 待办（按优先级）

1. SFTP 双主机竞态测试 + 修复
2. 云团队创建走真实服务端
3. Team Sync 跨版本 ADR 与安全策略
4. Settings/Hosts 失败态
5. Host Dialog 可访问性、Sidebar 键盘 resize、Settings 响应式
6. 源码冻结 → 官方矩阵 → 证据 → 最终 CI
