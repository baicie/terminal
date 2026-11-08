# Phase 9.8 — 对 Phase 9.7（PR #9）的集成审查

对象：PR #9 `feat/phase9-7-product-acceptance`，head `20efdff`（`src-tauri/src` 与
`packages/frontend/src` 的最后一个功能提交为 `2695f5c`/`f171969`）。审查方式：
静态检索 + 既有测试 + Phase 9.8 分支上的修复验证；未修改 PR #9 本身。

## 检查项与结论

| 检查 | 方法 | 结论 |
| --- | --- | --- |
| 测试专用功能是否进入生产 | `git grep smoke-vault-probe/smoke-updater 20efdff -- src-tauri` | **通过**：`updater_probe` 仅在 `#[cfg(feature = "smoke-updater")]` 下编译；vault probe 命令在无 feature 时为 no-op，并有构建断言 |
| 数据库迁移破坏 | 检索 `DROP TABLE`/`DROP COLUMN`/批量 `DELETE`（`hosts.ts` 的 `DELETE FROM hosts WHERE id = ?` 是单条用户删除） | **通过**：迁移只做加法（hosts 20→22 列等），无破坏性 DDL |
| 凭证泄露 | 检索 `console.*` 中的 token/password/secret；Vault 错误文案断言 | **通过**：无命中；既有测试断言密码/明文不进错误与日志 |
| Vault 并发创建单赢家 | `vault.rs` `fill_fresh_claim` 取锁后复查 + 回归测试 | **通过**：`created=2` 缺陷已修，测试在旧实现上失败 |
| 单实例锁在数据库初始化之前 | `lib.rs` 插件顺序 + `db_recovery::acquire_runtime_lock` + 前端 `getDb` 锁断言 | **通过**：`single-instance` 为第一个插件；运行时锁在任何数据库访问前取得，前端每次 `getDb` 校验 |
| 旧客户端策略与用户提示一致 | 服务端 426 文案 + 前端 `syncError` 消费方 | **不通过（已在本阶段修复）**：426 文案写入 store 的 `syncError`，但没有任何视图读取它——用户升级被拒时看不到原因。集成分支新增 Teams 同步错误横幅（原文 + 重试），三语键集由 parity 测试保证 |
| 证据与冻结源码匹配 | manifest 指纹 `32729825…` vs `20efdff`（其源码路径自 `2695f5c` 起未变） | **通过**：`check-verification-evidence` 在 PR #9 HEAD 上 0 problem；Phase 9.8 分支改动指纹路径后按规则重采 |
| 文档 READY 状态自洽 | 检索 `READY_FOR_RC`/`READY_FOR_RELEASE` | **通过**：phase9-7 与 rc-readiness 均为 NO，无相互矛盾的 READY 声明 |
| 跨版本兼容性声明 | ADR `adr-legacy-sync-policy.md` + 实跑结果 | **通过（作为阻塞项如实记录）**：A→B=FAIL 被明确写成 RC 阻塞，而不是被粉饰为 PASS |

## 判定

`PR9_REVIEW_VERDICT=REQUEST_CHANGES`

唯一阻断项是**用户提示缺失**：客户端被 426 拒绝时，UI 不显示任何信息。该修复不在
PR #9 内，已随 Phase 9.8 集成分支交付（Teams 视图错误横幅 + 重试）。其余检查项
通过，未发现需要阻止合并的数据安全或身份隔离缺陷。

不自动合并。是否合并 PR #9 由人工决定；若在 Phase 9.8 合并前合并 PR #9，用户将暂时
看不到同步失败原因（数据仍安全）。
