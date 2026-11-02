# CI 与证据（P9.0-8）

## 1. 最终 HEAD 的 CI：全绿

运行 `41230214611`，SHA `030fda4`，**run_conclusion = success**。

| job | conclusion | 类别 |
| --- | --- | --- |
| Frontend quality | success | blocking |
| Team Server quality | success | blocking |
| Team Server container | success | blocking |
| Rust quality | success | blocking |
| Production source-size gate | success | blocking |
| Tauri build (macos-latest) | success | blocking（含安装链 + 数据保留） |
| Tauri build (windows-latest) | success | blocking（含 PowerShell 解析门禁 + 安装链 + 数据保留） |
| Tauri build (ubuntu-latest) | success | blocking（含 deb/AppImage 安装链 + 数据保留） |
| zsh probe diagnostic | success | **diagnostic**（continue-on-error: true） |

### 关于 zsh probe diagnostic 的准确表述

它本次是 success，但它配置了 `continue-on-error: true`，因此**它的成功不构成产品门禁**。
它的正确身份是**证据采集器**。本次转绿的原因是 P9.0-6 修好了诊断脚本自身的一个缺陷：
`plain` 变体原本不给任何启动文件（`zsh -i` + 空 HOME），在 Debian 上会撞上系统 rc 的 compinit 阻塞，
吞掉注入字节——**那是诊断缺陷，不是产品缺陷**。

产品侧的 shell 门禁是 `real-machine-matrix.yml` 里的 `smoke:shell-probe:matrix` 步骤，一行未改。

## 2. 本轮修复的三个 CI 阻塞（都是实际被 CI 抓出来的）

### 2.1 macOS/Linux 上应用未完成 SQLite schema（#59）

两层根因，同一类 bug，出现在两个模块里：

1. 用**绑定参数**调用 pragma 表值函数（`pragma_table_info(?)`）——pragma 的参数在语句预处理阶段求值
2. 把 `database.select` **取出后脱离实例调用**——插件方法是类方法，内部读 `this.path`

两次都是**单测全绿、真机全红**，原因相同：mock 比真实实现宽松。

定位手段是新增的启动阶段插桩，它把「猜哪一层」变成「读哪一行」。此前读代码猜过四次全错。

### 2.2 Windows 验证脚本无法解析

`ParserError: Missing closing }` 报在第 276 行，但真因是第 279 行单引号字符串里的 `app's` 撇号
提前终止了字符串，后续全部错位。用忽略字符串的括号配平分析显示整体 `{ }` 完全平衡——
**人工复核看不出这类问题**。

修法是让 CI 自己在最早的步骤用 PowerShell 解析器校验（`Parser::ParseFile`），
把 20 分钟后的无行号 exit 1 变成几秒内的四行精确错误。

### 2.3 Linux 清理失败把全绿的作业打红

实测顺序：`[SUMMARY] data-retention verify: 74 passed, 0 failed` → `[PASS] Linux install chain ... completed`
→ `rm: cannot remove ...: Directory not empty` → exit 1。

所有断言都通过了，是 EXIT trap 里的 `rm -rf` 与仍在写入的 AppImage 进程竞态。
修法：重试 + 显式 `return 0`，结构上不可能改写退出码。

### 2.4 迁移漂移

`Team Server quality` 曾失败在「Verify migrated database matches schema」。
唯一差异是 PostgreSQL 把 `pg_current_xact_id()::text::bigint` 规范化成 `((pg_current_xact_id())::text)::bigint`，
而 `schema.prisma` 写的是前者。对齐后 `No difference detected.`

## 3. 证据采集

- 源码冻结于 `030fda4`（之后只有 `docs/` 提交，不在 `FINGERPRINT_PATHS` 内）
- 矩阵运行：见最终报告
- 采集后用 `fetch-verification-evidence.mjs` 回填并跑证据门禁

## 4. 不得声称的事

- 不得把 `zsh probe diagnostic` 的 success 说成「产品门禁通过」
- 不得声称依赖审计为 0 漏洞（见 `dependency-audit.md`：27 条）
- 不得把 NOT_RUN 项（Gatekeeper/SmartScreen/公证/物理键盘/IME/跨版本升级）计入通过