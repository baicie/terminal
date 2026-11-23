# R06 — 证据与隐私终审

> 要求：JSON 转义绕过、多行终端输出、Windows 路径、邮箱误判、API key / 私钥、
> 历史证据被当成当前。**历史公开 Git 提交仍可能含个人标识，只能形成审计与处理方案，
> 不未经授权改写 Git 历史。**

---

## 一、结论

| 面 | 结果 |
| --- | --- |
| **当前证据链**（manifest 引用的 6 份） | **0 泄漏** |
| `e2e/gui/artifacts/` 入库的证据 | **0 泄漏** |
| 历史 `docs/verification/*.json` | **6 个文件含本机用户名/home 路径**，全部已被取代 |
| 门禁覆盖 | `check-verification-evidence.mjs` **没有隐私检查** —— 这是缺口 |

---

## 二、当前证据链是干净的（实测）

`evidence-manifest.json` 引用的 6 份文件逐份扫过：

```
clean  2026-10-11-macos-cold-start-current.json
clean  2026-10-11-macos-release-ssh-matrix.json
clean  2026-10-11-macos-release-terminal-gate.json
clean  2026-10-11-macos-remote-shell-prompt-rerun.json
clean  2026-10-11-macos-shell-interaction-current.json
clean  2026-10-11-macos-ssh-matrix-current.json
```

`e2e/gui/artifacts/` 下本轮改动与新增的 JSON / PNG 同样 **0 命中**（用户名与 home 路径
两种模式）。

---

## 三、历史遗留：6 个文件含本机标识

| 文件 | 泄漏字段 |
| --- | --- |
| `2026-10-10-macos-remote-cold-start.json` | `command` / `application.bundle` |
| `2026-10-11-macos-release-cold-start.json` | 同上 |
| `2026-10-11-macos-shell-interaction-probe.json` | 同上 |
| `2026-10-11-macos-remote-shell-prompt.json` | `application.bundle`、`fixture.username` |
| `2026-10-13-macos-ssh-matrix-fresh.json` | `command` |
| `2026-10-11-macos-ssh-matrix-rerun.json` | `command` |

典型形态：

```json
"command": "PATH=/Users/<user>/n/bin:$PATH pnpm smoke:ssh-matrix"
"application": { "bundle": "/Users/<user>/Desktop/.../Termius.app/..." }
"fixture": { "username": "<user>", ... }
```

**这 6 个都不再被 manifest 引用** —— 它们被同名的 `-current` / `-rerun` 版本取代，
那 6 份是干净的。所以当前验收链不受影响。

### 处理方案（**未执行**，需授权）

| 方案 | 影响 | 建议 |
| --- | --- | --- |
| A. 保持现状，只记录 | 历史提交里仍可查到本机用户名；对一个开源仓库这是低危但真实的信息暴露 | 若无公开发布计划，可接受 |
| B. 新增一份 redacted 副本并更新引用 | 不改历史，但目录里有新旧两份，读者会困惑 | 不推荐 |
| **C. 用 `git filter-repo` 重写历史** | 彻底消除，但**改写全部 commit SHA**，所有已发出的引用（PR、文档里的 SHA）全部失效 | **需要明确授权**，且本仓多处文档记录了旧 SHA |

**本轮不执行任何一项**，因为 R06 明确禁止未经授权改写 Git 历史，而 A/B/C 都有代价。
记录在此，由人决定。

---

## 四、门禁缺口：`check-verification-evidence.mjs` 没有隐私检查

```bash
grep -n "redact\|liuzhiwei\|privacy" scripts/check-verification-evidence.mjs
# (无输出)
```

GUI 证据有脱敏（`e2e/gui/fixtures/evidence.mjs` 的 `redact` / `redactDeep`，覆盖
`notes`、`terminal`、`command`、`extra`），但 `docs/verification/` 那套**没有**任何
脱敏或扫描。

这就是那 6 个文件能存在的原因：它们的字段（`command`、`application.bundle`、
`fixture.username`）从未走过任何规则。

### 建议（本轮未实施）

在 `check-verification-evidence.mjs` 加一条阻塞检查：任何入库证据不得包含
`/Users/<name>/`、`/home/<name>/`、`C:\\Users\\<name>\\` 形态的路径，
以及当前 `os.userInfo().username` 的字面出现。

未实施的理由：它会立刻让那 6 个历史文件变红，而修复它们需要 §三 的决定。先有决定，
再加门禁 —— 反过来会得到一个红的、被忽略的门禁。

---

## 五、五类误报/绕过逐项核对

| 检查项 | 结果 |
| --- | --- |
| **JSON 转义绕过** | `redactDeep` 在序列化**之前**遍历对象，所以 `\u002f` 之类的转义形态不构成绕过 —— 它处理的是值，不是文本 |
| **多行终端输出** | `redact` 用 `[\s\S]*?` 而非 `.`，跨行私钥能被匹配；`terminal` / `command` 走 `redactDeep` |
| **Windows 路径** | **已覆盖**，实测见下 |
| **邮箱误判** | 规则里没有邮箱模式，不存在把 `user@host` 提示符误判成邮箱的问题 |
| **API key / 私钥** | 有 `-----BEGIN … PRIVATE KEY-----`、`sk_`/`ghp_`/`github_pat_`、`Bearer`、`password=` 四类规则 |

### 三条路径规则逐条实测

```js
"/Users/alice/x"    -> "/Users/[user]/x"
"/home/bob/y"       -> "/home/[user]/y"
"C:\\Users\\carol\\z" -> "C:\\Users\\[user]\\z"
```

Windows 形态确实有规则。**本报告的第一版断言「Windows 路径未覆盖」，那是错的** ——
我凭印象写了结论而没有打开 `redact` 读，随后用 grep 立刻推翻了它。记在这里，是因为
「没读就写结论」正是这类审计最容易出的错。

需要注意的是这条规则只覆盖 `C:\Users\<name>\` 形态；Windows 上证据若出现其他
盘符或 `%APPDATA%` 展开后的非常规路径，不在覆盖范围内。这一点没有 Windows 证据
样本可验证，记为 `WINDOWS_EVIDENCE_SAMPLE = NOT_VERIFIED`。

---

## 六、判定

```
CURRENT_EVIDENCE_PRIVACY            = PASS   （manifest 6 份 + 本轮 artifacts 全 0 命中）
HISTORICAL_EVIDENCE_PRIVACY         = PARTIAL（6 个旧文件含本机标识，已被取代，未改写历史）
EVIDENCE_GATE_COVERS_PRIVACY        = NO     （check-verification-evidence.mjs 无此检查）
UNIX_PATH_REDACTION                 = PASS   （实测 /Users、/home 两种形态）
WINDOWS_PATH_REDACTION              = PASS   （实测 C:\Users\<name>\，非兜底断言）
WINDOWS_EVIDENCE_SAMPLE             = NOT_VERIFIED（本机无 Windows 证据可扫）
JSON_ESCAPE_BYPASS                  = PASS
MULTILINE_SECRET_REDACTION          = PASS
PRIVATE_KEY_AND_TOKEN_REDACTION     = PASS
```
