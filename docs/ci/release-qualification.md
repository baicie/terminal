# Release Qualification

## 1. 现有检查不够

`prepare-release` 原本只验证：

- tag 符合版本规则
- tag 解析到的 commit == checkout commit
- `package.json` / `tauri.conf.json` / `Cargo.toml` 版本一致

这些是**必要条件**，但都不回答最关键的问题：**这个 commit 通过 CI 了吗？**

一个 tag 可以打在从未通过 CI 的 commit 上。更隐蔽的是：CI 在**更早的 commit** 上是绿的，
之后又推了两个 commit，tag 打在最新的那个 —— 徽章是真的，只是描述的是别的代码。

## 2. 新增的判定

`scripts/verify-release-qualification.mjs` 的 `judgeRelease(facts)` 是纯函数，
`scripts/release-facts.mjs` 负责用 `gh` 收集事实。

| 事实 | 不满足时的后果 |
| --- | --- |
| tag 解析到该 commit | 打在一个未合并的想法上 |
| 每个 required check **在这个 SHA 上** success | 用别的 commit 的绿冒充 |
| 证据 qualification 通过 | 验收数据描述的是别的代码 |
| 无缺失场景、无 NOT_RUN | 少一项证明就是少一项，不是通过 |
| 模式自身的承诺 | `fully-signed` 没有公证仍标为已签名 |

### 2.1 为什么「check 跑在别的 SHA 上」单独判

这是 tag 最容易掩盖的失败。实现里每个 check 记录 `headSha`，与 `facts.commit` 比对，
不匹配报 `check-wrong-sha`。

### 2.2 三种模式的承诺必须与实物一致

| 模式 | 需要更新签名 | 需要公证 |
| --- | --- | --- |
| `unsigned-qa` | 否 | 否 |
| `updater-signed` | **是** | 否 |
| `fully-signed` | **是** | **是** |

反向也检查：**`unsigned-qa` 模式下环境里却有签名密钥**时报 `mode-mismatch`。理由是
产物与标签对不上 —— 用户看到的是「未签名」，而实际带了签名，两者必有一个是错的。

保持既有设计：`fully-signed` 在没有 Apple notarization 凭据时**直接失败**，不降级。

## 3. 测试（16 项）

| 测试 | 钉住什么 |
| --- | --- |
| a fully qualified release passes | 正常路径 |
| a check that ran on a different commit is rejected | `check-wrong-sha` |
| a missing required check is rejected | `check-missing` |
| a failed or cancelled check is rejected | failure / cancelled / timed_out / neutral / null |
| a tag that does not resolve to the commit is rejected | `tag-not-on-commit` |
| a malformed tag or commit is rejected | 格式 |
| evidence that does not describe this commit is rejected | `evidence-not-qualified` |
| a missing scenario is rejected even when the gate passed | 门禁通过但覆盖更少 |
| a scenario recorded NOT_RUN is rejected | NOT_RUN 不是 PASS |
| an unknown mode is rejected rather than treated as the loosest one | 默认不放行 |
| a signed mode without a key is rejected | `mode-needs-updater-key` |
| fully-signed without notarization is rejected | `mode-needs-notarization` |
| an unsigned mode with a signing key present is rejected | `mode-mismatch` |
| unsigned-qa passes when it really is unsigned | 反向不误伤 |
| the three modes state what they promise | 契约 |
| the required check list includes the aggregate gate | 不能跳过合并要求的检查 |

## 4. Updater 发布顺序

### 4.1 现状（改造前已基本正确）

实测 `verify-release` 的顺序：

1. 校验 8 个安装包存在且非空
2. 下载并生成 `SHA256SUMS.txt`
3. `updater-signed` 模式下生成并上传 `latest.json`
4. **然后** `gh release edit --draft=false`
5. 打印成功消息

`latest.json` 确实在发布**之前**上传，符合「updater 不能提前指向不可用版本」。

### 4.2 补上的部分：发布后验证

原来的最后一步只是 `echo "Published ..."` —— `gh release edit` 返回 0 只表示 GitHub
接受了请求，不表示：

- release 真的可见（不是仍是 draft）
- 资产仍在
- 每个资产真的可下载
- `latest.json` 是可用的 manifest

新增在发布**之后**：

| 检查 | 实现 |
| --- | --- |
| 不再是 draft | `jq -r '.draft'` == `false` |
| 有资产 | `.assets \| length` > 0 |
| 每个资产可下载 | 对 `browser_download_url` 发 `curl --head` |
| `latest.json` 在且可解析 | 下载后 `jq -e '.version and .platforms'` |

**顺序上的取舍**：先发布再确认 manifest 可达。原因是 manifest 指向 draft 会让每个客户端的
更新坏掉，而反过来（已发布但 manifest 不可达）只影响更新、不影响安装。检查失败时任务是红的，
但 release 保持已发布 —— 回滚是人工决定，不由 CI 自动执行。

## 5. 未做

- **Windows ARM64 / Linux ARM64 的 updater 条目**：`latest.json` 目前只含 4 个平台
  （darwin-aarch64、darwin-x86_64、windows-x86_64、linux-x86_64）。两个 arm64 平台能装
  但不能自动更新。这是既有的产品限制，未在本轮改变。
- **发布后回滚**：没有实现自动回滚。失败时 release 保持发布状态，人工决定。
- **真实发布验证**：本轮没有创建任何 tag 或 Release，因此上述新检查**未在真实发布中执行过**。
  `NOT_RUN`。
