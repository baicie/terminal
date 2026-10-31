# Phase 9.0 最终报告

> 基线 b0a8b57（任务书给的审查基线是 60d2841，实际 HEAD 已前进 3 个提交，按其规定以新 HEAD 为唯一工作基线）
> 源码冻结于 030fda4。之后只有 docs/ 与 docs/verification/ 提交，均不在 FINGERPRINT_PATHS 内。

## 1. 整体结果

| 门禁 | 结果 |
| --- | --- |
| pnpm verify all | **exit 0** — All requested verification groups passed |
| CI（030fda4，run 41230214611） | **9/9 success，run_conclusion=success** |
| 证据门禁 | **passed**，run 41231265959，指纹 2f62fabd... |
| 实机矩阵 | macOS success、Windows success、**Linux failure**（产品 shell probe 的 zsh 三条） |

## 2. 阶段完成状态

| 阶段 | 状态 | 关键证据 |
| --- | --- | --- |
| P9.0-0 基线 | 完成 | docs/phase9/baseline.md，五类证据分开 |
| P9.0-1 旧游标兼容 | **完成** | 改前 210 只交付 200（丢 10 条），改后 210/210；199/200/201/210/5000 全部完整交付；5001 显式 upgradeRequired 且零数据 |
| P9.0-2 同步作用域 | **完成** | 加入 500 条历史团队 -> 500/500；退出后本地 0 行；串号时已落库 0 行 |
| P9.0-3 旧写入安全 | **完成** | 改前旧副本真的覆盖新版数据（data=b-stale），改后 conflict 且版本未变 |
| P9.0-4 SQLite 初始化 | **完成** | 两层根因：pragma 绑定参数 + 方法解绑；三平台 schema 初始化通过 |
| P9.0-5 三平台验收 | **完成** | macOS/Windows/Linux 安装链 + 内容级数据保留全部通过（Linux 74 passed / 0 failed） |
| P9.0-6 SSH/zsh | 完成（诊断） | SSH 只占 70ms/2.8%；1003ms 是产品写死的 settle；zsh 是诊断脚本缺陷非产品缺陷 |
| P9.0-7 可靠性治理 | **完成** | 快照保留、vault 静默吞错（安全相关）、分页上限、resync 幽灵行、@ts-nocheck |
| P9.0-8 冻结与证据 | **完成** | 源码冻结、证据重采、门禁 green、八份文档 |

## 3. 测试基数（只增不减）

| 层级 | 基线 | 现在 |
| --- | --- | --- |
| 前端 | 149 文件 / 1333 | **150 文件 / 1347** |
| Rust | 294 + 3 | **301 + 3** |
| team-server 单测 | 116 | **117** |
| 真实 PostgreSQL | 37 | **51** |
| 门禁脚本 | 254 | **264** |
| 生产文件 | 554 | **558** |

## 4. 这一轮最有价值的三个发现

### 4.1 mock 比真实实现宽松，掩盖了两层真实缺陷

#59 的两层根因（pragma 绑定参数、方法解绑）都是**单测全绿、真机全红**：
mock 接受任意参数，且是普通函数不依赖 this。测试验证的是「我以为的接口」，不是「真实的接口」。

### 4.2 猜测与日志的对比是压倒性的

| 手段 | 结果 |
| --- | --- |
| 读代码猜测（快照顺序、DB_KEY、水合条件、建表顺序） | **4 次全错** |
| 加启动阶段插桩后读运行时日志 | **每次一轮定位** |

### 4.3 只能在 CI 上验证的东西，必须让 CI 在最早的步骤验证

Windows 脚本的语法错误（单引号字符串里的撇号）埋在第 14 步，前 13 步包括几分钟的 Tauri 构建全白跑。
加了 PowerShell 解析门禁后，同样的错误在几秒内以四行精确信息出现。

## 5. 四个独立状态

### READY_FOR_REVIEW = 是

理由：38+ 个提交、每个 P0 都有「先证明失败再证明修复」的证据、八份交付文档、CI 全绿、证据门禁 green。

### READY_FOR_MERGE = 是（附条件）

合并门禁（ci.yml）9/9 全绿且 verify all exit 0。证据门禁通过且指纹与冻结源码一致。

**必须同时知道**：
- 实机矩阵的 Linux 作业仍失败（产品 shell probe 的 zsh 三条），这是 ci.yml 之外的门禁
- 依赖审计有 27 条已知漏洞（不阻塞合并，阻塞发布）

### READY_FOR_RC = 否

阻塞项：
1. **Linux 产品 shell probe 仍失败**（zsh 三条）。诊断已确认是 plain 变体缺启动文件导致的**诊断缺陷**，
   但产品门禁本身未修好，且需要真实 Linux runner 复跑确认
2. **macOS 远程冷启动 10 次里 2 次失败**，失败时 stages 为 none recorded（WebView 主框架加载失败，code=-1004）。
   这是真实的不稳定，不是 SSH 慢
3. **27 条依赖漏洞**（含 9 条 high）

### READY_FOR_RELEASE = 否

阻塞项：
1. **27 条依赖漏洞**，其中 9 条 high (7.5)，含核心 SSH 链路的 russh/rustls/rsa
2. **无真实签名链路**：Apple Developer ID 与公证、Windows Authenticode 均未配置
3. **产品身份未决策**：Termius 是既存商业产品名，商标未清查
4. Linux 产品 shell probe 未闭合

## 6. 未验证范围（NOT_RUN，不得计入通过）

| 项 | 原因 |
| --- | --- |
| Gatekeeper / SmartScreen / Authenticode / 公证 | 需人工 GUI 决策，CI 无签名身份 |
| 真实 UI 读回 | runner 无 GUI 自动化栈 |
| Vault 加密往返 | 需交互式主密码（加密正确性由 rust vault_tests 覆盖） |
| Linux 桌面会话菜单集成 | runner 无桌面会话 |
| Windows 跨版本升级 vN->vN+1 | CI 只构建一个版本 |
| 物理键盘、中文 IME、dead key | 需人工键入 |
| 前端依赖漏洞审计 | 镜像源不提供 audit 端点 |
| 许可证清单 | 同上 |

## 7. 不得声称的事

- 不得声称「依赖审计为 0 漏洞」——实际 27 条
- 不得把 zsh probe diagnostic 的 success 说成产品门禁通过
- 不得把 NOT_RUN 项计入验收通过
- 不得声称协议改动向后兼容——写入侧是**破坏性变更**，无降级路径，回退旧二进制必须同时停写