# T01 冷启动验收（macOS 实测）

> 基线 `main@3c0c841`。实测 2026-11-21。
>
> **先读第 4 节：这次的数字与 Phase 9.4 的 3412 ms 不是同一个 case，不可直接比较。**

## 1. 测的是什么

`scripts/run-local-cold-start-stopwatch.mjs`（`--case cat-eof`）。

它测量的终点**不是窗口出现**，而是一条往返：

```
spawn → main.tsx 求值 → DB 就绪 → 本地 Tab 挂载 → session 创建
      → 前端把 nonce 命令经 xterm 写入 → session_write → 本地 PTY 执行
      → PTY 输出回传 → Rust 探针在输出里看到 nonce → 写 marker 文件
```

marker 的内容是运行时随机 nonce，只有真正走过 PTY 并读回输出才可能匹配。窗口画出来而终端不可输入时，这个 marker 不会出现。

## 2. 环境

| 项 | 值 |
| --- | --- |
| 设备 | Apple M1，macOS 15.7.7 |
| 构建 | `VITE_TERMINAL_SMOKE_BUILD=1 pnpm tauri build --no-bundle -- --features custom-protocol` |
| 二进制 | `src-tauri/target/release/terminal`，35,031,344 B，2026-11-21 15:42 |
| 源码 | `main@3c0c841`（工作树干净） |
| 样本 | n = 20，串行，同一台机器，无并发负载 |

## 3. 结果

| 指标 | 毫秒 |
| --- | --- |
| 最小 | 918 |
| **中位** | **1124** |
| **p95** | **1224** |
| 最大 | 1230 |

原始样本（升序）：

```
918 1120 1120 1120 1121 1122 1123 1123 1123 1124
1124 1124 1124 1124 1124 1127 1222 1224 1224 1230
```

分布很紧：中位与 p95 相差 100 ms，最大值只比中位高 106 ms。没有长尾，也没有离群样本被丢弃。

时间去向：

| 分段 | 毫秒 | 说明 |
| --- | --- | --- |
| spawn → 第一个 stage | 814 | WebView 加载 bundle |
| App 自身时间线（第一个 stage → ready） | 161 | 产品代码 |
| **spawn → ready** | **1331** | 该样本总计 |

即：这条路径的耗时**绝大部分在 WebView 起来之前**，产品自己的启动逻辑只占 161 ms。

## 4. 与 Phase 9.4 基线的比较（不可直接比）

`docs/phase9-4/rc-readiness.md` 的 G 轮基线是 **中位 3412 ms / p95 3722 ms**，但那是：

| | G 轮（3412 ms） | 本次（1124 ms） |
| --- | --- | --- |
| case | **remote** 布局恢复 | `cat-eof` 本地 PTY |
| 终点 | 恢复的 **remote** session 可用 | 本地 PTY 往返完成 |
| 样本量 | 300（CI runner） | 20（本机） |
| 机器 | GitHub macOS runner | 本机 Apple M1 |

**两个数字描述的是不同的事情**。本地的 `cat-eof` 不恢复远程布局、不建立 SSH、不走 host key 校验，所以更快是预期内的。把它写成「冷启动快了 3 倍」是错的。

因此本次**不宣称相对 G 轮有任何改进或回归**。要判断回归，必须在同一 case 上重采基线——这需要 `remote` case 的 sshd fixture，不在本次范围内，记为 `NOT_RUN`。

## 5. 未覆盖

| 平台 | 状态 | 原因 |
| --- | --- | --- |
| macOS | 本文件 | — |
| Windows | `NOT_RUN` | `run-cold-start-stopwatch.mjs` 明确只支持 macOS/Linux（`'cold-start stopwatch is supported on macOS and Linux only'`）。Windows 需要另建测量链，不是配置问题 |
| Linux | `NOT_RUN` | 脚本要求 `readinessMode: 'remote'` + marker 证据，本地无法提供 sshd 矩阵环境 |

**三平台中的两个没有数据。不要把这个文件读成「跨平台冷启动已验收」。**

## 6. 过程中发现的真实缺陷

跑通这条链花了比预期长得多的时间，原因是一个**误导性的失败信息**：

```
the front end evaluated but never reached db ready
```

实际原因是**构建变体不对**：探针 UI 只在 `VITE_TERMINAL_SMOKE_BUILD=1` 的构建里，而用普通
`tauri build` 时 `loadShellProbeRoot` 会抛
`'Terminal shell probe UI is not included in this build'`，这个异常被 bootstrap 的
fail-closed 路径吞掉，最终表现为「前端求值了但没到 db ready」。

诊断成本：先后误判为超时不足（25 秒仍失败）、DB 路径问题（手动启动一切正常）、
环境变量缺失（`TERMINAL_SHELL_PROBE` 确实要设，但那是脚本自己设的）。

**这条信息应该直接说「探针 UI 不在此构建中，请用 VITE_TERMINAL_SMOKE_BUILD=1 重建」。**

修复记在 `scripts/run-local-cold-start-stopwatch.mjs`：启动前检查 dist 里是否有探针模块，
没有就立刻报出构建命令，而不是让超时信息误导诊断。
