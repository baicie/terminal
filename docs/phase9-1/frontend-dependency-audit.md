# 前端依赖漏洞审计与许可证清单（Phase 9.1）

> 本文接替 `docs/phase9/dependency-audit.md` 第 2、3 节的两项 **NOT_RUN**。
> 两项的结论**不同**，不要合并阅读：
>
> | 项 | 本轮结论 | 证据类别 |
> | --- | --- | --- |
> | 前端依赖漏洞 | **仍是 NOT_RUN**（沙箱拒绝全部 9 个外部域名，无任何本地公告库可替代） | NOT_RUN |
> | 许可证清单 | **已取得**（离线读取 403 个生产包的 package.json） | 实测 |
>
> 采集时间 2026-11-01，`node v22.12.0` / `pnpm 10.34.3`，macOS Darwin 24.6.0。
> 未改动 `package.json` / `pnpm-lock.yaml` / `.npmrc`，本轮只做测量。

---

## 1. 前端依赖漏洞：NOT_RUN（被网络策略挡住）

### 1.1 三条路径的确切结果

任务要求按顺序尝试，逐条记录。三条全部失败，**失败原因与上一轮不同**，必须更正记录。

#### 尝试 1：默认镜像源

```bash
pnpm -C packages/frontend audit --prod --audit-level high
```

实测输出：

```
 ERR_PNPM_AUDIT_BAD_RESPONSE  The audit endpoint (at
 https://registry.npmmirror.com/-/npm/v1/security/audits/quick) responded with
 403: Connection blocked by network allowlist. Fallback endpoint (at
 https://registry.npmmirror.com/-/npm/v1/security/audits) responded with 403:
 Connection blocked by network allowlist
```

**这里要更正上一轮的记录。** `docs/phase9/dependency-audit.md` 写的是
`ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`（镜像不实现该端点）。本轮实测是
`ERR_PNPM_AUDIT_BAD_RESPONSE` + **HTTP 403 Connection blocked by network allowlist**，
伴随 sandbox violation `deny network-outbound registry.npmmirror.com:443 (user denied)`。

差别有实质意义：403 来自**本机沙箱的过滤代理**，不是镜像源的能力缺失。
也就是说，「镜像源不提供 audit 端点」这个归因在本轮环境下**无法成立也无法否证**——
请求根本没有到达镜像源。本轮不保留那个归因。

#### 尝试 2：指定官方 registry

```bash
pnpm -C packages/frontend audit --prod --registry=https://registry.npmjs.org
```

```
 ERR_PNPM_AUDIT_BAD_RESPONSE  The audit endpoint (at
 https://registry.npmjs.org/-/npm/v1/security/audits/quick) responded with 403:
 Connection blocked by network allowlist. ...
```

同样是沙箱 403。所以**上一轮的建议「用官方 registry 跑一次」在当前环境下无效**，
它和镜像源被同一条策略拒绝。该建议只在 CI 等放行 registry 的环境里才可行。

#### 尝试 3：不依赖 registry audit 端点的离线方案

| 方案 | 结果 | 确切阻塞点 |
| --- | --- | --- |
| `osv-scanner` 已装？ | 未安装 | `command -v osv-scanner` 无输出 |
| `go install github.com/google/osv-scanner/v2/...@latest` | 失败 | `Get "https://proxy.golang.org/...": user denied` |
| `brew install osv-scanner` | 失败 | `Dir.mkdir: Operation not permitted @ dir_s_mkdir - /Users/liuzhiwei/Library/Caches/Homebrew (Errno::EPERM)`（沙箱不可写，未触及网络） |
| `grype` / `trivy` 已装？ | 均未安装 | `command -v` 无输出 |
| 本机是否有可离线查询的 npm 公告库？ | **没有** | `~/.cargo/advisory-db` 只有 `crates/` 与 `rust/` 两个目录，不含 npm 生态；pnpm/npm 缓存内无 audit 数据 |

### 1.2 被拒绝的域名（逐个实测，非推断）

```bash
for h in registry.npmjs.org registry.npmmirror.com api.osv.dev \
         osv-vulnerabilities.storage.googleapis.com proxy.golang.org \
         pypi.org files.pythonhosted.org formulae.brew.sh ghcr.io; do
  curl -s -o /dev/null -w "$h -> %{http_code}\n" --max-time 8 "https://$h/"
done
```

9 个域名全部返回 `000`，并逐个产生 `deny network-outbound <host>:443 (user denied)`。
其中 `api.osv.dev` 与 `osv-vulnerabilities.storage.googleapis.com` 是 OSV 离线库的下载源，
`proxy.golang.org` 是 Go 工具链源，`pypi.org` / `files.pythonhosted.org` 是 Python 侧替代方案源。

**结论：当前沙箱内不存在可行的前端漏洞测量路径。** 既无法在线查询，也无法安装离线扫描器，
更没有可用的本地公告库。按仓库纪律，这一项记为 **NOT_RUN**。

### 1.3 这一项不能写什么

- ❌ 不得写「前端生产依赖无已知漏洞」——**一条都没测到，不是测到 0 条**
- ❌ 不得写「前端依赖审计通过」或把本项计入任何通过计数
- ❌ 不得沿用「镜像源不提供 audit 端点」这个归因（见 1.1，请求未到达镜像源）

### 1.4 要取得这项数据，需要什么

这一项**不是**靠换工具或改写脚本能解决的，缺的是网络放行。可行路径二选一：

1. **在 CI 里跑**（推荐）。CI runner 不受本机沙箱限制。`.github/workflows/` 由其他会话负责，
   本轮未改动，仅给出需要被放行的域名与命令：

   ```bash
   pnpm -C packages/frontend audit --prod --audit-level high --registry=https://registry.npmjs.org
   ```

   需放行 `registry.npmjs.org`。注意 `--prod` 不可省：见 2.6，前端 dev 闭包 440 个对
   生产闭包 135 个（3.3 倍），把两者混为一谈会把构建工具的漏洞算进产品暴露面。

2. **本机放行后跑 osv-scanner**，对 `pnpm-lock.yaml` 离线扫描：

   ```bash
   osv-scanner --lockfile=pnpm-lock.yaml
   ```

   需放行 `proxy.golang.org`（安装）与 `osv-vulnerabilities.storage.googleapis.com`（公告库）。

两条路径都能产出带 advisory id 与依赖链的逐条数据。届时请按 Rust 侧
`docs/phase9-1/security-advisories.md` 的结构建台账，并用 `scripts/cvss.mjs`
的 `cvssBaseScore` 从 CVSS 向量复算基准分，不要照抄工具的 severity 标签
（Rust 侧 27 条里有 11 条上游未发布向量，npm 侧同样会有缺口，需单独计数而非默认填等级）。

本轮因此**没有**产出漏洞台账 json 与生成脚本：没有数据，脚本会是空壳。
许可证侧有数据，脚本与 json 都已产出（第 2 节）。

---

## 2. 许可证清单：已取得（离线实测）

### 2.1 `pnpm licenses list` 为什么不可用

```bash
pnpm -C packages/frontend licenses list --prod --json
```

```json
{
  "error": {
    "code": "ERR_PNPM_MISSING_PACKAGE_INDEX_FILE",
    "message": "Failed to find package index file for @baicie/xterm@0.1.7(patch_hash=...) (at .pnpm-store/v10/index/d0/...json), please consider running 'pnpm install'"
  }
}
```

这与镜像或网络无关：本仓库给 `@baicie/xterm` 打了 patch
（`patchedDependencies`，`patches/@baicie__xterm@0.1.7.patch`），
该命令在 store 索引里找不到 patch 后的条目就整体失败。
**不得按上一轮的说法记为「镜像下无可解析输出」**，原因是 patch 导致的 store 索引缺失。

它不可用不影响结论：许可证字段就在每个已安装包的 package.json 里，**不需要网络**。

### 2.2 实际采用的方法

```bash
pnpm -r list --prod --depth Infinity --json > "$TMPDIR/prod-tree.json"
pnpm -r list        --depth Infinity --json > "$TMPDIR/all-tree.json"
node scripts/build-license-inventory.mjs \
  --prod "$TMPDIR/prod-tree.json" --all "$TMPDIR/all-tree.json"
```

产物：`docs/phase9-1/frontend-license-inventory.json`（机器可读）。
同一份输入连跑两次，除 `inputs` 字段（记录快照路径，用于溯源）外逐字节一致：
行排序按包 key，分布表按计数降序、同计数按名称排序，不依赖遍历顺序。

- 生产闭包来自 `pnpm list --prod`，**由 pnpm 判定生产性**，不是脚本重新解释 package.json。
- 许可证取每个包 package.json 的 `license`；缺失时回落到已废弃的 `licenses` 数组
  （`busboy`、`streamsearch` 只有后者，回落把这 2 个「无许可证」行还原成实际的 MIT）。
- 两者都没有的包记为 `absent`，**绝不默认按宽松许可证处理**。

### 2.3 SPDX 表达式是被解析的，不是子串匹配

这一点决定报告是否会误报，`scripts/license-classify.mjs` 的职责就在此：

- `MIT OR GPL-3.0` 命中了 copyleft 标识符，但**没有** copyleft 义务——OR 允许选 MIT。
  报成 copyleft 是误报，而误报会让真实发现被忽略。
- `MIT AND GPL-3.0` 是同一个标识符，却**有**义务——AND 要求同时满足。

所以每个顶层 OR 分支独立判定，任一分支无 copyleft 则义务可规避；分支内 AND 每项都生效。
未识别的标识符归为 `unknown`，不会悄悄当成宽松许可证（「没认出来」和「没问题」是两件事）。

本仓库 `MIT OR Apache-2.0`（8 个）与 `Apache-2.0 OR MIT`（2 个）共 10 个包因此正确计为宽松。

### 2.4 结果：生产依赖中没有 copyleft

生产闭包去重后共 **403** 个包（三个 workspace 根的并集；已安装包总数 1091，其余为 dev）。

| workspace 根 | 生产闭包 | 强 copyleft | 弱 copyleft | 许可证未知 | 读不到 |
| --- | --- | --- | --- | --- | --- |
| `@terminal/frontend` | 135 | **0** | **0** | 0 | 0 |
| `team-server` | 274 | **0** | **1** | 1 | 0 |
| `@terminal/monorepo`（根） | 0 | 0 | 0 | 0 | 0 |

**桌面应用（`@terminal/frontend`，即打进 Tauri 包的那部分）的 135 个生产依赖里，
没有任何 copyleft 许可证，也没有一个包的许可证读不出来。** 分布：

| 许可证 | 包数 |
| --- | --- |
| MIT | 118 |
| MIT OR Apache-2.0 | 8 |
| ISC | 3 |
| Apache-2.0 | 2 |
| Apache-2.0 OR MIT | 2 |
| 0BSD | 1 |
| BSD-3-Clause | 1 |

项目自身声明 MIT，与此一致。

### 2.5 三个需要人读一眼的条目（全部在 team-server，均非强 copyleft）

这三条不埋在表里，逐条列出。**没有 AGPL/GPL/SSPL，强 copyleft 为 0。**

**(1) `elkjs@0.11.1` → EPL-2.0（弱 copyleft）**

```
team-server > @prisma/client@7.9.1 > prisma@7.9.1 > @prisma/studio-core@0.33.0 > elkjs@0.11.1
```

EPL-2.0 是文件级互惠：对该组件自身的文件有源码提供与声明义务，**不会**把周围产品一起传染。
两点降低它的实际影响，但都需要人确认而不是由我判定：

- 它经 `prisma` **CLI** 包进入。`team-server/package.json` 把 `prisma` 放在 `dependencies`
  而非 `devDependencies`，所以 pnpm 判它为生产依赖；它实际是迁移/生成用的命令行工具，
  且 `elkjs` 来自 `@prisma/studio-core`（Prisma Studio 的图形布局库）。
- `team-server` 是**独立部署的服务**（有自己的 `Dockerfile` / `docker-compose.yml`），
  `src-tauri/tauri.conf.json` 不引用它，**不随桌面应用分发**。

若要彻底移除这条义务，可评估把 `prisma` 移到 `devDependencies`。
**本轮未改**（任务明确不改 package.json），留作后续决定。

**(2) `seq-queue@0.0.5` → 无许可证字段**

```
team-server > @prisma/client@7.9.1 > prisma@7.9.1 > mysql2@3.15.3 > seq-queue@0.0.5
```

package.json 既无 `license` 也无 `licenses`，目录下有 LICENSE 文件但未声明 SPDX。
归为 `unknown`——**没有许可证声明不等于可自由使用**，需要人读那个 LICENSE 文件。
同样经 prisma CLI 链引入，不随桌面应用分发。

**(3) `@visx/vendor@4.0.0-alpha.0` → `MIT and ISC`（AND，非 OR）**

```
team-server > ... > @prisma/studio-core@0.33.0 > @visx/curve@4.0.1-alpha.0 > @visx/vendor@4.0.0-alpha.0
```

两半都是宽松许可证，所以**不是** copyleft 问题；但 AND 意味着两份声明义务同时生效，
需在声明文件里同时列出。单列是因为它会被「都是宽松」一句话盖过去。

### 2.6 dev 依赖里的 copyleft：存在，但不是产品暴露面

| 根 | dev-only 包数 | 弱 copyleft | 许可证未知 |
| --- | --- | --- | --- |
| `@terminal/frontend` | 440 | **2** | 52 |
| `team-server` | 406 | 0 | 0 |
| `@terminal/monorepo` | 53 | 0 | 35 |

那 2 个弱 copyleft 是 `lightningcss@1.32.0` 与 `lightningcss-darwin-arm64@1.32.0`（**MPL-2.0**），
经 `@tailwindcss/vite > @tailwindcss/node > lightningcss` 引入，是**构建期 CSS 工具**。
MPL-2.0 同为文件级互惠，且构建工具不进分发物，因此**不构成产品合规问题**。
但它正是「必须区分 prod 与 dev」的实例：若按全部依赖统计，这 2 条会被当成产品侧 copyleft 误报。

87 个「许可证未知」全部是**读不到 package.json 的跨平台可选二进制**
（`lightningcss-win32-*`、`@tailwindcss/oxide-*`、`@esbuild/*` 等：在 macOS 上不安装）。
它们被如实计入分母并标为 `unreadable`，而不是跳过——跳过会缩小分母、让清单显得比实际完整。

---

## 3. 新增脚本与自检

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `scripts/license-classify.mjs` | 287 | SPDX 表达式解析与 copyleft 分级 |
| `scripts/license-classify.test.mjs` | 133 | 11 项 |
| `scripts/license-inventory-tree.mjs` | 170 | `pnpm list --json` 闭包遍历 |
| `scripts/license-inventory-tree.test.mjs` | 197 | 9 项 |
| `scripts/build-license-inventory.mjs` | 382 | 清单生成与序列化 |
| `scripts/build-license-inventory.test.mjs` | 250 | 12 项 |

合计 **32 项全绿**（11 + 9 + 12）。`scripts/` 不在 `check-source-size.mjs` 的
扫描根内（它只看 `packages/*/src`），故 300 行限制不适用于此处；
`build-license-inventory.mjs` 的 382 行在 `scripts/` 既有规模中属偏小
（该目录最大的 `terminal-smoke-password-sshd.mjs` 为 1635 行）。
`scripts/verify.mjs` 从磁盘自动收集
`scripts/*.test.mjs`，无需登记即已纳入门禁：

```bash
node --test scripts/license-classify.test.mjs scripts/license-inventory-tree.test.mjs scripts/build-license-inventory.test.mjs
```

脚本沿用 Rust 侧 `build-security-ledger.mjs` 的纪律：输入路径必须显式传入，
**不回落到陈旧快照**，缺参或文件不存在时以 exit 2 失败并打印生成命令
（描述过时闭包的清单比没有清单更糟）。

### 遍历中发现并修掉的一个真实缺陷

`pnpm list --json` 对重复出现的包标 `deduped` 并**省略其子树**（本仓库 1164 个节点中
539 个带该标记）。最初的广度优先遍历按 key 去重，保留最短链——而最短链往往正是
那个**未展开**的出现，于是整棵子树被静默丢弃。

后果不是少几行，而是**结论反了**：`elkjs` 在 `prisma` 下第 4 层，被丢掉后
团队服务端的生产闭包报 58 个包、copyleft 0 条，是一份干净但错误的清单。
修正为「每个出现都要下钻取子节点，包自身仍只记一次（保留最短链）」后，
闭包变为 274 个包并浮现 EPL-2.0。两份独立实现的交叉核对（不动点展开 vs 广度优先）
在修正后一致。`license-inventory-tree.test.mjs` 以 `elkjs` 的真实形状锁了这条回归。

此事也说明本文第 2 节的数字为什么标「实测」而非「推断」：每个计数都能用上面的命令复算，
而两个版本的差异是靠复算发现的，不是靠阅读代码猜的。

---

## 4. 对发布门禁的影响

| 项 | 本轮结论 | 对 RC / Release 的影响 |
| --- | --- | --- |
| 前端依赖漏洞 | **NOT_RUN**（9 个域名全被拒，无本地公告库） | 仍未闭合，**不得计入通过**；需 CI 放行 registry 后补测 |
| 许可证清单（桌面应用） | 135 个生产包，copyleft **0**，未知 **0** | 本项已取得证据；与项目声明的 MIT 一致 |
| 许可证清单（team-server） | 274 个生产包，弱 copyleft 1（EPL-2.0），未知 1 | 独立部署、不随桌面应用分发；2 条待人工确认，非阻塞 |

前端漏洞一项仍是 Phase 9.1 的未闭合项，与 Rust 侧实测的 27 条
（`docs/phase9-1/security-advisories.md`）性质不同：Rust 侧是**测到了负面结果**，
前端侧是**没测到**。两者都不能写成通过，但不可混为一谈。
