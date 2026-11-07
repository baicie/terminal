# Phase 9.7 — Vault App-Level E2E

> 分支 `feat/phase9-7-product-acceptance`（Draft PR #9）
> 代码 HEAD：`172207d`（结果以最终 E2E 为准）

## 1. 目标与边界

证明真实应用内的链路：

```
StartupGate 放行 → VaultService(frontend) → Tauri invoke →
Rust vault command → VaultState → vault.json（Argon2id + AES-256-GCM）
```

本轮使用 **smoke 构建内的服务级 probe**，不是 WebDriver/UI 自动化。它会经过
前端 `VaultService`、真实 Tauri command 和真实文件，但不点击 UI 控件。
因此：`VAULT_APP_LEVEL_*` 可以判 PASS（应用级命令链 + 重启持久化），
`VAULT_UI_AUTOMATION` 单独标 **NOT_RUN**，不把服务级 probe 冒充 UI 验收。

## 2. 双重门控

| 门 | 作用 |
| --- | --- |
| 编译期 `VITE_TERMINAL_VAULT_PROBE=1` | 仅 smoke 构建包含 probe 分支；普通构建被裁剪 |
| 运行期 `vault-probe.enabled` 标记文件（隔离数据目录内） | 只有测试 HOME 触发；真实用户数据目录不会触发 |

probe 使用一次性的测试密码/秘密，只输出布尔值与阶段名；harness 断言日志中
不出现密码或秘密。测试目录为一次性 HOME，不触碰真实用户数据。

## 3. 覆盖序列

第一次启动（无 Vault）：

1. 创建 Vault（主密码 P1）
2. 写入测试秘密
3. 锁定
4. 错误密码解锁 → `invalid_password`
5. P1 解锁
6. 读取秘密
7. 改密 P1 → P2
8. 锁定
9. 旧密码 P1 解锁 → `invalid_password`
10. 新密码 P2 解锁并读取秘密
11. 锁定

第二次启动（同一 HOME，进程重启）：

1. 旧密码 P1 → `invalid_password`
2. P2 解锁
3. 读取秘密（重启持久化）
4. 锁定

## 4. 实现位置

- `packages/frontend/src/service/vault-probe.ts`：probe 序列与结构化输出
- `packages/frontend/src/startup-gate.tsx`：放行后按双重门控触发
- `src-tauri/src/lib.rs`：`vault_probe_enabled` 读取隔离目录标记
- `scripts/verify-install/vault-app-e2e.mjs`：安装真实 .app、启动两次、解析结果、
  校验日志不含秘密、失败也写结构化报告
- `.github/workflows/upgrade-e2e.yml`：macOS current job 的 Vault 步骤

## 5. 结果

Upgrade E2E [`42348255027`](https://github.com/baicie/terminal/actions/runs/42348255027)
（`e0dd992`）的 Vault 步骤
[job 128330620531](https://github.com/baicie/terminal/actions/runs/42348255027/job/128330620531)：`vault-app-report.json` 为 **PASS**。

- 创建 Vault、写入秘密、锁定、错误密码拒绝、正确密码解锁并读取；
- 改密后旧密码拒绝、新密码读取秘密；
- 第二次启动：旧密码仍拒绝、新密码解锁、秘密完整（重启持久化）；
- 日志不含任何测试密码或秘密；
- 链路为 frontend `VaultService` → Tauri command → VaultState → 加密文件；
  **UI 点击自动化 NOT_RUN**，A→B 跨版本 Vault **NOT_RUN**。

## 6. 未闭合

- **UI 自动化**：未接入 WebDriver/tauri-driver，未点击真实控件。
- **A→B 跨版本 Vault**：历史 A 构建不可插桩，无法在 A 内运行 probe；
  `VAULT_CROSS_VERSION_VERIFIED=NOT_RUN`。B 端文件兼容性已有 Rust 已知答案
  测试与 Node Argon2id fixture（Phase 9.5.2）。
- **篡改密文/旧 verifier**：Rust `VaultState` 测试覆盖；本轮 probe 不重复。
