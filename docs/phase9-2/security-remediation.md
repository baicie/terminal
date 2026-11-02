# Phase 9.2 安全问题整改

> 2026-11-02。基线 HEAD `84f73b0`。所有数字来自本机实跑，命令写在每节里，可复现。

## 摘要

| 指标 | 本阶段开始时 | 现在 | 说明 |
| --- | --- | --- | --- |
| `cargo audit` 漏洞（vulnerabilities） | **25** | **8** | 其中 7 条不在任何构建图的锁文件残留 |
| 构建图内真实漏洞 | 4 | **1** | 仅 rsa（上游无修复版本） |
| 已撤回（yanked）版本 | 4 | **0** | aes / chacha20 / spin / 一个传递依赖已升级 |
| unsound 告警 | 4 | **1** | anyhow / event-listener / tokio 已升级修复 |
| unmaintained 告警 | 9 | **4** | 现存的 4 条全部 Linux-only，来自 Tauri 的托盘与通知栈 |
| 合计条目 | 42 | **13** | 修掉 29 条 |
| 安全 CI | `continue-on-error: true` 的诊断 job | **阻塞门禁** | 三种结果严格区分 |
| 安全 CI 覆盖的告警类别 | 只有 vulnerabilities | **vulnerabilities + unsound + unmaintained + yanked** | — |
| 前端依赖漏洞审计 | NOT_RUN | **NOT_RUN** | 见第 7 节，仍是缺口 |

**这一节最重要的结论，不要被上面的箭头读错：** 8 条漏洞里仍有 1 条是真实的、在三个平台都生效的、且上游没有修复版本的暴露（rsa 的 Marvin 攻击）。**本阶段没有把生产依赖审计做到 0 个已知漏洞，也不声称做到了。** 能做到的是：把「没人看着」变成「有门禁、有台账、有逐条复核命令」。

---

## 1. 起点：25 条是什么

开工时 `cargo audit` 报 25 条漏洞 + 17 条告警（9 unmaintained / 4 unsound / 4 yanked），合计 42 条。逐条按可达性分类后：

| 分类 | 条数 | 说明 |
| --- | --- | --- |
| 锁文件残留（不在任何构建图） | 6 | quinn-proto ×5、rkyv ×1 |
| 在构建图内 | 19 | 分布在 quick-xml、russh、rsa、crypto-bigint、zip 等 |

> 上一阶段记录的 27 条与本轮起点的 25 条不同，是因为 phase9.1 已修掉 2 条（quick-xml 0.39.2 → 0.42.0，经 plist 1.10.1）。这条链在本阶段没有回退。

---

## 2. 已修复的 29 条（附命令）

每一条都是真实升级，不是改数字。全部通过 `cargo check --locked --all-targets --all-features` 与 `cargo test --locked --all-targets --all-features`（302 单测 + 3 集成测试）。

### 2.1 直接依赖升级

| 依赖 | 从 | 到 | 修掉的 advisory |
| --- | --- | --- | --- |
| `tauri-plugin-updater` | 2.12.0 | 2.14.1 | zip（4 条，经 zip 4.6.1 → 9.0.0） |
| `tauri-plugin-notification` | 2.4.1 | 2.8.0 | quick-xml ×2（换掉了 tauri-winrt-notification，其 0.8.1 不再钉 ^0.37） |
| `ssh-key` | 0.6 | 0.7.0-rc.11 | 见 2.2 |
| `russh` | 0.60 | **0.65** | 见 2.2；同时清掉 unic-* 系列 5 条 unmaintained（RUSTSEC-2025-0075 / -0080 / -0081 / -0098 / -0100，随旧版依赖树整体消失） |

### 2.2 russh 0.60.3 → 0.65.0（本阶段最大的一次迁移）

这一步修掉 4 条在构建图内的漏洞（crypto-bigint ×2、rsa ×2 中的旧版本链），代价是四类 API 变更，每一处都改了源码而不是绕过：

**a) `check_server_key` 的签名从 `&PublicKey` 变成 `&PublicKeyOrCertificate`**

russh 0.65 把服务器可能出示证书这件事提到了类型层面。两处实现都改了：

- `src-tauri/src/ssh_host_key.rs`：新增 `probe_key_to_record()`，把「该记录哪把公钥」的判断从 handler 里拆出来变成可单测的纯函数。出示证书时返回 `None`——证书里嵌的公钥不该被写进 known_hosts，否则会污染该主机的条目。
- `src-tauri/src/state.rs`：证书分支取 `cert.public_key()` 包成 `PublicKey` 走原有的 known_hosts 校验。**这是一个有意的决定，不是遗漏**：本应用没有「每主机配置受信任 CA」的设置，凭空引入一套 CA 校验会静默拒绝所有今天能用的证书认证服务器。代码注释里写明了这个取舍。

**b) `server_channel_open_agent_forward` / `server_channel_open_forwarded_tcpip` 新增 `reply: ChannelOpenHandle`**

russh 0.65 之前靠 drop 隐式拒绝。新版要求显式应答，且 drop 的默认行为是 `AdministrativelyProhibited`。两处都显式调用了：

- agent 转发未授权 → `reply.reject(AdministrativelyProhibited)`，并**移除**了原来随后的 `channel.close()`：open 从未成功，没有需要关闭的通道，再发 CHANNEL_CLOSE 是多余的线上帧。
- agent 转发授权且连接 agent 成功 → `reply.accept()`。
- forwarded-tcpip 有监听者 → `reply.accept()`；无监听者 → 不调用，靠 drop 拒绝（这正是想要的语义，且注释说明了理由）。

**c) `ssh_key` 0.7 移除了 `rand_core::OsRng`**

rand_core 0.10 把 OS 生成器改成可失败的 `getrandom::SysRng`。改用 `UnwrapErr(SysRng)`——这是 crate 文档给出的、把可失败生成器适配成不可失败 `CryptoRng` 的适配器。一个失败的 OS RNG 本来也不是密钥生成能继续下去的状态。

**d) `Comment` 从 `&str` 兼容类型变成不透明字节类型**

测试里的 `assert_eq!(key.comment(), "")` 改成 `assert!(key.comment().is_empty())`。

### 2.3 补丁级升级（本阶段新增）

| 依赖 | 从 | 到 | 修掉 |
| --- | --- | --- | --- |
| `spin` | 0.9.8（yanked） | 0.9.9 | 已撤回版本 |
| `chacha20` | 0.10.0（yanked） | 0.10.2 | 已撤回版本 |
| `aes` | 0.9.0（yanked） | 0.9.3 | 已撤回版本 |
| `anyhow` | 1.0.102 | 1.0.104 | RUSTSEC-2026-0190（unsound） |
| `event-listener` | 5.4.1 | 5.4.2 | RUSTSEC-2026-0221（unsound） |
| `zvariant` / `zvariant_derive` | 5.10.1 | 5.15.1 | 无（仍 unmaintained，但取最新） |
| `tokio` | 1.52.1 | **1.53.3** | RUSTSEC-2026-0386（unsound） |

tokio 这条值得单独说：advisory 写明修复从 1.51.6 / 1.53.3 / 1.54.0 起。先升到 1.53.2 不解决，再试 1.54.0 发现**该版本已被作者撤回**（cargo 会警告），最终停在 1.53.3——文档点名的、未被撤回的修复版本。

---

## 3. 剩余 13 条：逐条结论

`cargo audit --json` 现在报 **8 条 vulnerabilities + 4 条 unmaintained + 1 条 unsound + 0 条 yanked = 13 条**。台账见 `docs/phase9-1/security-advisories.md`（由脚本从本次快照重新生成）。

### 3.1 不在任何构建图：7 条

| advisory | crate | 版本 | 为什么不在图里 |
| --- | --- | --- | --- |
| RUSTSEC-2026-0185 / -0338 / -0339 / -0340 / -0342 | quinn-proto | 0.11.14 | quinn 是 reqwest 的 `http3` 可选依赖，本仓库全程未启用 http3 |
| RUSTSEC-2026-0235 | rkyv | 0.7.46 | rust_decimal 的 `rkyv` 可选特性未启用（注意 rust_decimal 本身**在**图里，所以这条靠特性关闭而非父 crate 缺席） |
| RUSTSEC-2023-0071 | rsa | 0.9.10 | 只经 sqlx-mysql（sqlx 的 MySQL 后端），本项目 sqlx 只开 `sqlite` + `runtime-tokio` |

复核命令（必须打印 `nothing to print`）：

```bash
cd src-tauri
cargo tree --invert quinn-proto@0.11.14 --target all --all-features
cargo tree --invert quinn@0.11.9 --target all --all-features      # 确认整棵 QUIC 子树缺席
cargo tree --invert rkyv@0.7.46 --target all --all-features
cargo tree --invert rust_decimal@1.41.0 --target all --all-features  # 对照组：这条会打印 sqlx 链
cargo tree --invert rsa@0.9.10 --target all --all-features
```

### 3.2 真实但只在 Linux：5 条

| advisory | crate | 类别 | 依赖链条 |
| --- | --- | --- | --- |
| RUSTSEC-2024-0429 | glib 0.18.5 | unsound | glib ← atk ← gtk ← libappindicator ← tray-icon ← tauri |
| RUSTSEC-2024-0370 | proc-macro-error 1.0.4 | unmaintained | ← glib-macros（proc-macro）← glib ← … |
| RUSTSEC-2026-0370 | zvariant 5.15.1 | unmaintained | zvariant ← zbus ← notify-rust ← tauri-plugin-notification |
| RUSTSEC-2026-0371 | zbus_names 4.3.2 | unmaintained | 同上 |
| RUSTSEC-2026-0372 | zvariant_derive 5.15.1 | unmaintained | 同上（proc-macro） |

**平台范围是实测的**，不是推断：

```bash
cd src-tauri
for t in aarch64-apple-darwin x86_64-unknown-linux-gnu x86_64-pc-windows-msvc; do
  cargo tree --invert glib@0.18.5 --target "$t" --all-features
done
# macOS / Windows: nothing to print；Linux: 打印 atk/gtk 链
```

这 5 条为什么可以接受：

- **glib 的 unsound** 出在 `VariantStrIter` 的迭代器实现。本项目 `src-tauri/src/` 里 `grep -rn 'glib'` 命中 0 次，唯一的 glib 入口是 Tauri 的托盘实现，它不迭代 `VariantStrIter`。修复在 gtk-rs 0.18.6+，Tauri 目前钉 0.18.5，只能等 Tauri 升级。
- **proc-macro-error / zvariant_derive** 都是 proc-macro，只在编译期运行，不产生随二进制发布的代码。
- **zvariant / zbus_names** 本仓库无直接调用（`grep -rn 'zbus\|zvariant' src-tauri/src/` 为 0）。advisory 本身说明 zvariant 已并入 zbus 6.0.0，这个迁移属于 notify-rust，不属于本项目。

### 3.3 真实、全平台、且修不了：1 条

**RUSTSEC-2023-0071，rsa 0.10.0-rc.18，Marvin 攻击（时序侧信道，CVSS 5.9 Medium）。**

- 链条：`rsa 0.10.0-rc.18 ← russh 0.65.0` 且 `← ssh-key 0.7.0-rc.11`，两者都在 SSH 核心链路上。
- **`patched = []`**：上游没有修复版本。RustCrypto/RSA#626 至今未关闭，维护者的立场是常量时间实现需要重写而非打补丁。
- **升不了级**：russh 0.65.0 和 ssh-key 0.7.0-rc.11 都精确钉死 `rsa = "=0.10.0-rc.18"`，补丁级升级都做不到。
- **不能关**：`russh` 的 `rsa` 特性默认开启，且本应用确实需要 RSA 密钥认证。为降低审计数字而关闭密码学后端是 Phase 9.2 明令禁止的做法。

暴露面：需要攻击者能用同一把密钥做大量解密计时，在 SSH 场景里意味着一个已认证的对端加上极低的网络抖动。本应用绝大多数时间是 SSH **客户端**，受影响的操作是 russh 用 RSA 私钥认证那一步。

缓解：代码层面没有。作为 dev 通道的已知风险接受，写进 `src-tauri/security-baseline.json` 的 `blocking: true` 条目。**任何 russh 发布换掉 rsa 后端都必须立刻跟进。**

---

## 4. 新门禁：`scripts/security-gate.mjs`

### 4.1 它解决什么问题

原来的 CI job 是 `continue-on-error: true`，且 `cargo audit` 后面跟 `|| true`。两个选择各有理由（27 条没法一个 commit 清完），但合起来的效果是：**job 永远显示 success，漏洞数从 21 涨到 27 又降到 25 没人发现；而且一次失败的扫描（没有 advisory-db、工具链坏了）和一次干净的扫描长得一模一样。**

新门禁把三种结果分开，退出码是契约的一部分：

| 退出码 | 含义 | CI |
| --- | --- | --- |
| `0` | 扫描到的全部条目都在基线内 | 通过 |
| `1` | 有新的 advisory，或已有的换了版本 | **失败** |
| `2` | 扫描本身失败（文件缺失/空/非 JSON/无 `vulnerabilities.list`/无 `warnings`） | **失败** |

`main()` 不带 `--audit` 直接返回 2——它不会回退到某个提交过的快照，因为旧扫描不等于扫描。

### 4.2 基线的键为什么是 kind+id+crate+version

`src-tauri/security-baseline.json` 按 `kind|id|crate` 建键，每条键下可以有多个版本。两个原因都是实际踩到的：

1. **一条 advisory 可能同时命中同一 crate 的两个版本。** rsa 今天就是：0.9.10 不在图里，0.10.0-rc.18 在图里——这是两个完全不同的决定，按 id 建键会让后者搭前者的便车。
2. **版本变了就是新的暴露。** 基线里记 0.9.10 而扫描报 0.10.0-rc.18，门禁判 `changed` 并失败，迫使改基线的人在 diff 里显式留下「我认为这个新版本也可接受」的痕迹。

### 4.3 覆盖四类而不是一类

`cargo audit --json` 把漏洞放在 `vulnerabilities.list`，把 unsound / unmaintained / yanked 放在 `warnings`。旧 job 只读前者。这个缺口是实际存在的：本仓库当时有 3 个已撤回版本和 4 条 unsound 告警，CI 一条都没看见。

新门禁把四类合并评级，`kind` 随行进入报告和基线，所以「漏洞」和「维护性信号」在记录里是分开的。

### 4.4 为什么不用 cargo-deny

本阶段一开始把 cargo-deny 加进了 CI，随后撤回，原因是它的 ignore 只能按 advisory id：

> `RUSTSEC-2023-0071` 要忽略 rsa 0.9.10，就同时忽略了 rsa 0.10.0-rc.18——连同那条真实的、在构建图内的暴露一起静默。这正是 Phase 9.2 禁止的「为了让 CI 变绿而批量 ignore」。

另外 cargo-deny 0.20.2 的 ignore 条目只接受 `id` 和 `reason`（`expiration` 会被反序列化拒绝），豁免无法设置过期时间，复核触发条件只能写在自由文本里，没有任何机制强制它。

`src-tauri/deny.toml` 保留为**手工运行时的文档**，文件头明确写了它不是 CI 门禁。

### 4.5 测试

`scripts/security-gate.test.mjs`，**27 项**，`node --test` 运行。覆盖：三种退出码互不相同；缺文件/空文件/坏 JSON/非 audit 结构一律判 2；新 advisory 判 1；版本变化判 1；a 记录消失不失败；同键多版本可共存；重复条目报错；四类告警都进评级；yanked 条目合成稳定 id；缺失的告警类别视为「该类为空」而非错误。

---

## 5. `cargo audit` 与台账的一处刻意差异

`docs/phase9-1/security-advisories.md` 现在也包含 `warnings` 的四类（本节之前它只列 vulnerabilities）。这需要改 `scripts/build-security-ledger.mjs` 的两处：

- `readAudit()` 合并 `vulnerabilities.list` 与 `warnings.*`，每条带 `kind`。
- 表格新增「类别」与「受影响平台」两列。平台列是新加的 `findPlatforms()` 探测出来的——`--target all` 会把所有平台合并成一棵树，「在构建图内」这个结论对发布决策不够，必须能说清是哪个平台。

`SHIPPED_TARGETS` 列出 release.yml 实际构建的 6 个 target triple。

---

## 6. 前端依赖审计：NOT_RUN（仍未闭合）

**状态：NOT_RUN，不是 PASS，也不是「无漏洞」。**

`pnpm audit` 在本仓库的镜像源（registry.npmmirror.com）返回 `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`。上一阶段把原因归到「沙箱 403」，本轮复核后**更正**：是镜像源不提供 audit 端点，与沙箱无关。

`docs/phase9-1/frontend-license-inventory.json` 已有许可证清单（135 个生产依赖，零 copyleft），但**许可证清单不是漏洞审计**。

要在本轮真正闭合需要：可访问 npm 官方 audit 端点的网络环境，或一个离线的漏洞数据库镜像。两者在当前环境都不具备。**BLOCKED_EXTERNAL，保留为未测量项。**

---

## 7. 门禁现状与它不保证什么

CI 的 `cargo-audit` job 现在是阻塞的（无 `continue-on-error`），覆盖四类告警，基线 13 条。

**绿色在这里的含义是「没有未记录的 advisory」，不是「没有已知漏洞」。** 那 1 条 rsa 暴露是真实存在的，写在这里、写在基线里、写在台账里，并且在 CI 里显示为一条 `blocking: true` 的已记录条目而不是被隐藏。

复核触发条件写在每条的 `reReviewWhen` 里。一条 ignore 的触发条件已经成立却没人处理，那是一个新发现，不是一个已决定。

---

## 8. 复现全部结论

```bash
# 1. 扫描
cd src-tauri && cargo audit --json > /tmp/audit.json

# 2. 评级（应输出 13 条且 exit 0）
cd .. && node scripts/security-gate.mjs --audit /tmp/audit.json

# 3. 重建台账
node scripts/build-security-ledger.mjs --input /tmp/audit.json

# 4. 门禁自身的测试
node --test scripts/security-gate.test.mjs

# 5. 编译与测试
cargo check --locked --all-targets --all-features
cargo test  --locked --all-targets --all-features   # 302 + 3
cargo clippy --locked --all-targets --all-features -- -D warnings
```
