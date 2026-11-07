# Overnight sprint checkpoint — 2026-11-08

- 当前时间（北京时间）：2026-11-08 00:15
- 分支：`feat/phase9-7-product-acceptance`
- PR #9：Open，**非 Draft**
- 硬截止：2026-11-08 12:00 +08:00

## 基线

- main：`3b23e8c`
- 本轮起点 HEAD：`892137c`（i18n 全量扫尾）
- 起点 CI：`Repository gates` 因旧证据与 `fr/app.ts` 301 行失败；其余 job 绿
- 证据矩阵 `42388505322`（`892137c`）已取消，源码未冻结前不重采

## 已完成的 P0

- [x] `fr/en/cn` 的 `common.*` 键拆到 `locales/<lang>/common.ts`，`fr/app.ts` 301→263 行；
      `use-palette-static-results.tsx` 的快捷动作拆出；`sftp-container` 的三个对话框拆出。
      `check-source-size` 通过（582 文件）。

## 正在执行

- P0-1：SFTP 主机切换隔离与陈旧响应保护（待写失败测试）

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
