# Phase 8 · P8.1 Vault 安全与迁移

> 提交 `08dc637`。所有结论有代码与测试支撑。

## 1. 修复前状态（以代码为准复核）

| Issue | 缺陷 | 证据 |
| --- | --- | --- |
| #152 | `vault_unlock` 只读文件、解 salt、派生 key 就返回，**不校验密码**。错误密码要到首次 `get` 才 `DecryptFailed`；空 Vault 任意密码都能解锁成功 | 旧 `vault.rs:77-95`；仓库自己的测试注释 `vault_tests.rs:31-33` 写着 wrong password cannot be rejected by unlock alone |
| #153 | `vault_create` 走 `commit` → `write_atomic`（tempfile + persist），是**原子覆盖**。任何绕过前端的调用都会毁掉旧 Vault | 旧 `vault.rs` 的 create 路径 |

两处都与 `docs/issue.md` 的描述一致，文档没有夸大。

## 2. verifier 设计

```
verifier = base64( HMAC-SHA256( master_key, "terminal-vault-verifier-v1" || salt ) )
```

- **域分离串** `terminal-vault-verifier-v1` 是编译期常量，**不落盘**（有测试断言文件内容不含该串）
- `master_key` 仍由既有 Argon2 派生并截断 32 字节，**未改派生方式**（避免破坏所有既有 Vault）
- 存储字段 `verifier`：`#[serde(default, skip_serializing_if = "Option::is_none")]`，缺失即旧格式
- 比较用 `Hmac::verify_slice`（`CtOutput`，**常量时间**）；非法 base64 直接返回 false 不做比较
- 失配返回 `VaultError::InvalidPassword`，**无 message**，不回显任何内容
- 不记录密码、派生密钥、明文或解密内容——错误路径只有枚举值

## 3. 旧格式三条路径的实际行为

| 情形 | 行为 |
| --- | --- |
| 无 verifier + entries 非空 | 解密任意一条真实 entry（AES-GCM 认证即密码证明）。失败 → `InvalidPassword`，**不动文件**。成功 → 走既有 `commit → write_atomic` **原子**补写 verifier |
| 无 verifier + entries 为空 | **无任何校验材料**，`log::warn` 明确声明不可验证（不假装能验证），接受本次密码并**立即封存** verifier |
| 迁移写失败（注入预算） | `unlock` 返回 **Ok**（只 warn）。原文件字节逐个不变，目录里只剩 `vault.json`，旧密码可再次 unlock 并完成迁移 |

### 不可恢复的信息论限制（必须记住）

> 历史格式的**空** Vault 不含任何可用于校验密码的材料。因此首次解锁时接受输入并立即封存 verifier——**空 Vault 的首个输入密码即成为其主密码**。

这不是实现缺陷，是旧格式没有校验材料的必然结果。有数据的旧 Vault 永远走「解密真实条目」那条路，不受此影响。该代价已写进 `docs/issue.md` 与代码 doc comment。

## 4. 独占创建（#153）

- `OpenOptions::new().write(true).create_new(true)`：Unix `O_WRONLY|O_CREAT|O_EXCL`（另加 `.mode(0o600)`），Windows `CreateFileW CREATE_NEW`
- **存在性判断与创建是同一个内核操作**，没有「先查后写」的 TOCTOU 窗口
- 抢到占位文件后用既有 `write_atomic`（同名 temp → `sync_all` → `persist`）填充内容
- 填充失败：先 `drop` 句柄（Windows 必须先关才能删）再 `fs::remove_file` 删掉自己抢的占位文件 → **失败创建不留 vault 文件**
- 已存在 → `VaultError::AlreadyExists`（DTO kind `already_exists`）；目标被**目录**占据 → `SaveFailed`（语义上「不能放 vault 的路径」不等于「已有 vault」，且保住既有断言）
- **未提供 `overwrite` 参数**：那等于给普通 create 开一条新的破坏性入口，与本轮「不实现重置」冲突。重置能力留给将来独立的显式破坏性命令

## 5. 一处前端认知修正

`use-vaults-container.ts:80` 那条 create 调用链**整条从未被挂载**（`VaultsContainer*` 只在 `view/vaults` 内部互相引用）。真正生效的入口是 `vaults-view.tsx → useVaultsView`（`use-vaults-view.ts:70`）。

**若按文档去改 container，等于改了一段死代码。** UI 修复落在 `use-vaults-view.ts`，处理 `already_exists` 与错误密码两个状态，文案走 en/fr/cn 三语。

> **Phase 8.8 Task D 后续**：该死链已被确认不可达（依赖图 BFS）并删除，保留的 `use-vaults-view.ts` 已接入真实路由（`/vaults`）。详见 `ui-review.md` 第 5 节。

## 6. 测试

新增 13 例（既有 11 例一字未改）：

| 用例 | 覆盖点 |
| --- | --- |
| `a_new_vault_verifies_the_master_password_at_unlock` | 正确密码 |
| `an_empty_vault_rejects_every_password_but_its_own` | 错误密码（#152 核心） |
| `a_legacy_vault_with_entries_verifies_the_password_and_seals_a_verifier` | 历史非空 + 迁移 |
| `a_legacy_empty_vault_cannot_verify_and_seals_the_supplied_password` | 历史空 + 已接受代价 |
| `a_failed_verifier_migration_keeps_the_legacy_file_and_the_old_password_usable` | 迁移失败 |
| `change_password_rotates_the_verifier_together_with_the_salt` | 轮换 |
| `a_failed_change_password_keeps_the_old_verifier_and_the_old_password` | 失败回滚 |
| `a_verifier_minted_for_another_salt_is_rejected` | 跨 salt |
| `the_stored_verifier_is_a_base64_tag_and_stores_no_domain_label` | 域分离串不落盘 |
| `creating_over_an_existing_vault_is_refused_and_keeps_every_byte` | #153 核心 |
| `concurrent_creates_leave_exactly_one_vault` | 并发创建 |
| `every_read_only_path_keeps_the_legacy_bytes_intact` | 只读路径字节完整性 |
| `exclusive_create_holds_on_unix_and_windows_persistence` | 跨平台持久化语义 |

## 7. 验证

| 门禁 | 结果 |
| --- | --- |
| `cargo fmt --check` | 0 |
| `cargo clippy --all-targets -- -D warnings` | 0（0 error / 0 warning） |
| `cargo test` | **260 passed**（基线 247，+13）+ 3 集成 |
| 前端 `typecheck` / `lint` | 0 |
| 前端 `vitest` | 146 文件 / 1291 用例 |
| `check-source-size` | 559 生产文件通过 |

## 8. 残留风险

1. `#[cfg(not(unix))]` 分支（Windows `CREATE_NEW` 语义、无 `mode` 断言）**只编译，未在真实 Windows 运行**。
2. `use-vaults-container.ts` 死链未同步——若将来被挂载，需一并处理 `already_exists` 与 i18n。
3. verifier 的引入意味着**任何未来的 Vault 格式变更都必须同时处理 verifier**，否则会让既有用户无法解锁。
4. 空 legacy Vault 的首个密码被封存这一窗口无法消除，只能把窗口缩到最短（已做）并文档化（已做）。
