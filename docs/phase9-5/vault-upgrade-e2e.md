# Phase 9.5.2 — Vault Encryption and Upgrade Continuity

> 日期：2026-11-05
> 代码：`scripts/verify-install/vault-crypto.mjs`、`src-tauri/src/vault_tests.rs`
> fixture：`src-tauri/tests/fixtures/vault-node-fixture.json`
> 判定：`VAULT_UNLOCK_AFTER_UPGRADE = PARTIAL`

## 1. 真实格式

Vault 文件：

```json
{ "salt": "<16-byte unpadded base64>", "entries": { "host": "<base64(nonce12||ciphertext||tag16)>" }, "verifier": "<base64 HMAC-SHA256>" }
```

- KDF：Argon2id v19，m=19456 KiB，t=2，p=1，32-byte key；
- 加密：AES-256-GCM，每条 fresh 12-byte nonce；
- verifier：`HMAC-SHA256(key, "terminal-vault-verifier-v1" + salt)`。

旧 fixture 的 salt 是 padded `cGhhc2U4OS12YXVsdDE2IQ==`，`SaltString::from_b64`
会拒绝 `=`，因此旧“空 vault”不能真实解锁；本轮不再把它当作真实 Vault 证据。

## 2. 两条独立证据

### 2.1 Node 生成 / Rust 解密

`vault-crypto.mjs` 用 Node 24 `crypto.argon2Sync` + `aes-256-gcm` 生成
`vault-node-fixture.json`（密码 `phase952-known-answer-password`，条目
`host=phase952-known-answer-secret`）。Rust 测试
`decrypts_the_external_node_fixture_and_rejects_a_wrong_password` 读取该文件，
用 `VaultState::unlock` 解密并断言错误密码返回 `InvalidPassword`。

运行：

```bash
cargo test --manifest-path src-tauri/Cargo.toml decrypts_the_external_node_fixture -- --nocapture
```

结果：**1 passed**；本地完整 Rust 单测 **303 passed**。

### 2.2 升级前后同一 fixture

`upgrade-e2e.mjs` 在 A 的 seed 后生成真实 fixture（同一 Node 格式），快照后升级
到 B；B 停止后调用 `verifyVaultFile`：

- 正确密码解密 `host` 条目；
- 错误密码被拒绝；
- 文件仍是升级前的加密条目，未被 A/B 覆盖。

本机 normal / restore / downgrade / interrupted 报告均显示：

```
vault encrypted fixture          PASS
vault crypto unlock after B      PASS
vault wrong password rejected    PASS
```

## 3. 证据边界

- 这是**独立 Node 验证器**对真实密文的解密，不是应用 UI 的 `vault_unlock`
  命令；应用命令仍需要 GUI/IPC 或专用 probe，本轮没有实现。
- `VAULT_UNLOCK_AFTER_UPGRADE = PARTIAL`：真实 KDF/AES 格式、Rust 解密兼容、
  升级后条目可解密、错误密码拒绝均已验证；**app-level unlock 仍是 NOT_RUN**。
- 没有使用生产密码、真实用户 Vault 或真实凭据。
- vault 不在数据库备份集内；恢复是 database-only，文档已注明。
- 历史 A（dev.1）没有可自动调用的 Vault probe；不能用外部脚本冒充 A 的应用
  级解锁。

## 4. 后续

1. 增加 `TERMINAL_VAULT_PROBE=1` 的 Rust/frontend probe，实际调用
   `vault_unlock`/`vault_get`，在 A、B 各跑一次；密码只通过测试文件或 stdin。
2. 增加 verifier 缺失的 legacy fixture，验证 B 解锁后原子补 verifier。
3. 增加 change_password 后旧密码拒绝、新密码解密的升级链。
4. 在 Windows 上用 debug-gated path override 或 VM 复测。
