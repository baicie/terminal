# Phase 9.5.3 — Vault App-Level Unlock

> 日期：2026-11-05
> 判定：`VAULT_APP_LEVEL_UNLOCK_VERIFIED = NOT_RUN`、
> `VAULT_CROSS_VERSION_VERIFIED = PARTIAL`

## 1. 已具备

- Node 24 Argon2id/AES-256-GCM fixture（`vault-crypto.mjs`）；
- Rust `VaultState::unlock` 解密外部 Node fixture 的已知答案测试；
- upgrade harness 在 A seed 后生成真实加密条目，B 停止后用独立 Node 验证器
  解密并拒绝错误密码；
- Rust 完整单测 303 项通过。

这证明 **格式与密码学兼容**，以及 **升级后的文件仍可被同一密码解密**；不证明
应用 UI/命令层 `vault_unlock`。

## 2. 为什么没有 app-level

`vault_unlock`/`vault_get` 是 Tauri command，`VaultState` 私有，路径由
`dirs::config_dir()` 决定，没有测试专用 path/probe。要真实调用需要：

1. Rust 增加 smoke/test gated 的 `vault_probe`（或 CLI）：
   - `TERMINAL_VAULT_PROBE=1`
   - 专用 `TERMINAL_VAULT_PATH`
   - 密码从测试文件/stdin 读取，不写日志/stdout
   - 只允许 smoke build；
2. 在 A/B 两个真实 app 进程上运行 probe；
3. 断言 create/set/unlock/get/change_password/错误密码/篡改/legacy verifier；
4. 失败时不覆盖原 Vault。

本轮没有实现该 probe，不能用独立 Node 验证冒充 app-level 成功。

## 3. 三项独立判定

| 项 | 结果 |
| --- | --- |
| crypto compatibility（Node fixture ↔ Rust） | **YES** |
| B app-level unlock | **NOT_RUN** |
| A→B app-level continuity | **NOT_RUN** |
| 升级后文件仍可独立解密 | **YES**（independent verifier） |

## 4. 后续

- 先做 B 的 probe（B 当前源码可控），再做 A 历史版本 probe；
- 用真实加密条目和测试密码，禁止生产凭据；
- 在 change_password 后重启再读回；
- 记录 KDF 参数版本，防止 Argon2 默认值漂移。
