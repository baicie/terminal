# DDQ12–DDQ16 只读审计：已经有什么、缺什么

四个独立审计 agent 各查一个方向，只读、不改文件。结论按 **已存在且已测试 / 存在但未测试 /
不存在** 三态记录。本文件是后续实现的依据，不是交付本身。

---

## DDQ12 — 输出期间的交互

### 已存在

- `e2e-08` 会等洪泛结束再输入，判据是**提示符正则**而不是载荷发出的标记。
- 分割 UI 真实存在且可键盘操作：`role="separator"` + `tabIndex=0` +
  Arrow 键每次 5 点，比例是单个标量，夹在 20..80。

### 不存在 / 有缺陷

| 事实 | 影响 |
| --- | --- |
| **没有任何 GUI spec 测过终端分割** | 全仓 `split` 的命中都是 SFTP 双栏、注释、或 dock 的假 splitter |
| **探针无法指定终端** | 每个方法都走 `activeTerminal()`，读的永远是可见的那个 |
| 分割布局下探针的可见性判定失效 | 分割 pane 带 `relative` 而非 `invisible`，两个都不"隐藏" |
| `e2e-08` 的 `tail.includes(token)` 会被**命令回显**满足 | 敲下去但从未执行的命令也算"通过" |
| `e2e-08` 不断言声明的载荷真的到达 | 只有 +200 行下限、scrollback+2000 上限；跑 300 行就死也会 PASS |
| `e2e-08` 的 `peakLines` 算了但从不写进证据 | 有生产者无消费者的字段 |

**对本轮的直接含义**：我写 DDQ12 时复制了 `tail.includes(token)` 这个缺陷，审计发现后已改成
精确行匹配（输出行的 trim 后内容必须**等于** token；回显行是 `echo <token>`）。

---

## DDQ14 — 可日用的 RC 构建

### 已存在且已测试

- GUI E2E 探针的构建期掩蔽生效（`import.meta.env.VITE_TERMINAL_GUI_E2E === '1'` +
  字面量比较 + 动态 `import()`）。
- `fully-signed` 模式一旦被选就立即失败（`RELEASE_NOTARIZED` 无人设置）。
- 生产 bundle 不含 fixture 凭据或测试数据。
- 快照原语 `VACUUM INTO` 天然规避 WAL。

### 不存在 / 有缺陷（按严重度）

| 事实 | 严重度 |
| --- | --- |
| **20 个测试专用 Tauri command 无条件注册进 release 二进制**（9 个 `terminal_smoke_*`、5 个 `input_probe_*`、2 个 `raw_input_*` 等） | **高** |
| **`TERMINAL_SMOKE=1` 能让生产二进制进入测试模式并以自身权限写任意路径文件** | **高** |
| **CI 的「Vault probe 不在生产 bundle」门禁是空转的**——它 grep `packages/frontend/dist`，而 vite 的 `outDir` 是仓库根的 `../../dist`，该路径不存在，grep 返回非零被当成 0 命中 | **高** |
| 没有任何门禁扫描生产 bundle/二进制中的开发者绝对路径 | 中 |
| `check-gui-e2e-profile-isolation.mjs` 存在但**从未被任何 workflow 执行** | 中 |
| `unsigned-qa` 模式当前无法产出安装包（无条件传 `TAURI_SIGNING_PRIVATE_KEY`，而 `judgeRelease` 在 unsigned+密钥时报错） | 中 |
| `packages/frontend/package.json` 仍是 `0.0.1-dev.1`，落后一个版本，无门禁发现 | 低 |
| 本机 `target/release/terminal` 是 `--features gui-e2e` 构建的 | 低（本机产物） |
| 安装包资产名 `Terminal_*` 但内含应用是 `Termius.app`，productName/identifier 都是第三方商业 SSH 客户端的名字 | 中（身份迁移项，早已记录） |
| `docs/verification/` 有 6 个入库文件含 `/Users/liuzhiwei` | 中 |
| 仓库没有「RC build」脚本或文档 | 低 |

---

## DDQ15 — 备份与恢复

### 已存在且已测试

- `VACUUM INTO` 快照 + 只读重开校验（integrity_check、列清单、行数）。
- 8 阶段 staged 恢复（PREPARE→QUIESCE→…→COMPLETE），独立 worker 上真实 SIGKILL 逐阶段验证。
- 快照命名唯一、绝不覆盖、失败清理、最多保留 5 份、活跃标记引用的永不清理。
- 启动时损坏且无迁移标记 → `MANUAL_INTERVENTION_REQUIRED`，绝不覆盖。
- JSON 导出已排除明文秘密（字段级白名单 + 引用不可解析时 fail-closed）。
- `vault.json` 只含密文。

### 不存在

| 事实 | 影响 |
| --- | --- |
| **没有用户可触发的「立即备份」命令或 UI** | 稳定版本不产生任何新备份；七天试用期间不会自动得到 |
| **产品内没有「用某份备份恢复」的路径** | `restore_from_snapshot` 只由迁移标记驱动 |
| **Vault 不在任何备份机制内**，恢复也不校验能否解密 | 备份含 DB 不含 vault.json = 有一堆指向不存在密文的引用 |
| 恢复不保留「恢复前那一刻的 live DB」 | staged 校验后直接 rename 覆盖 |
| 快照与恢复链不跑 `PRAGMA foreign_key_check` | — |
| `terminal.db` 与 `backups/` 是 **0644**，而 `vault.json` 是 0600 | 未跑凭据迁移的机器上，0644 文件里有明文密码列 |
| 导出是**有损往返**：`identity_file_path` 既不在导出白名单也不在导入 payload | 这类主机导出→导入后既无凭据也无路径，且不进重绑报告 |
| 导出**不覆盖**连接记录、`command_history`、`port_forward_rules` 等 | DDQ15 明列需要保留的「连接记录」缺失 |
| 导出面板文案互相矛盾（一处说"可能含密码"，另一处说"不含"） | 用户无法判断备份文件能否安全存放 |

### 七天试用文档的错误（如果照做会丢数据）

1. 手工备份步骤只复制 `terminal.db` 主文件——**违反 WAL 一致性**，丢失已提交数据；
2. 文档说 `vault.json` 与 `terminal.db` 同目录——**实际不在**（`dirs::config_dir()/terminal/` vs
   identifier 目录），照做只备份到 DB；
3. 文档说导出在「设置 → 存储」——**实际在「数据」页**。

---

## DDQ16 — 日用 UX

### 最关键的一条

**产品里没有任何 GUI 控件写 `reconnectBaseDelayMs` / `reconnectMaxAttempts`。**
这两个键只存在于 TypeScript 类型与启动时的读取路径里，没有任何地方写它们。

所以 DDQ16 要求的「GUI 修改 → 单例策略生效 → 重启保持」三步里，**第一步不存在**，
后两步因此无法成立。

其余：

- 内部路径是真的：`applyReconnectSettings → setReconnectPolicy → TerminalReconnectPolicyHolder`。
- **重连阶梯不逐次重读策略**：在一轮阶梯开始时捕获一次，连重试预算也一起捕获。
  所以「进行中的 ladder 如何处理策略变更」——答案是「不处理」。
- items (c)(d) 都没有测试。
- 启动不保证在恢复的 tab 开始重连前已应用策略（apply 在四个 await 之后）。
- RC19 章节自相矛盾：章节写 NOT_RUN，同文件的 §六 表写已截图。
- F13 的两行文档夸大了证据（说"设置里可存"，而 GUI 没有）。

---

## 这批审计的意义

它们推翻了三件我原本准备当作"已具备"的东西：

1. DDQ16 的 GUI 设置路径**不存在**；
2. DDQ14 的生产二进制里有 20 个测试 command，且那条 vault 门禁是空转的；
3. DDQ15 的七天试用文档如果照做**会丢数据**。

每一条都需要单独处理，不能合并成一个"文档修正"。


---

## 后续：两个修复尝试的结果

### 已修 —— Vault probe 门禁（PR #183 → `17c8a26`）

`ci.yml` 里那条门禁 grep 的是 `packages/frontend/dist`，而 vite 的 `outDir` 是
`'../../dist'`。路径不存在 → `grep` 非零 → `if` 读成「没有匹配」→ 门禁从写下那天起
每次都通过。

已改成 `dist` 并加 `test -d dist ||` 前置。两条测试钉住（路径从 `outDir` 反推、
必须有 `test -d`），两条变异各自变红。

### 已关闭 —— 20 个测试 command 的 feature 门控（PR #184，未合并）

审计说的缺陷是真的：`generate_handler!` 无条件注册 20 个测试专用命令，且
`TerminalSmokeState::from_env()` 在每次构建都读 `TERMINAL_SMOKE`。

我加了 `smoke-probe` feature 并门控了命令、state、模块与 `setup()`。本地三种配置
（默认 / `--features smoke-probe` / `--all-features`）都编译通过，497 项 Rust 测试
通过，5 条守卫全绿、三条变异全红。

**但 CI 上三个平台的 Tauri build 全部失败**，失败点是安装链 `verify-install-macos.sh`：

```
[FAIL] db-exists condition not reached within 180s after 167 probe(s)
[FAIL] the app never created … /terminal.db inside the isolated HOME within 180s
```

应用日志停在 `main.tsx evaluated` —— 前端启动了，数据库从未被创建。main（`c800d0e`）
的同一步骤通过。

**本地无法复现**：裸 `cargo build --release` 的二进制在隔离 HOME 下同样不建 DB，
main 的二进制也一样——那是本机 headless 环境的限制，不是这次改动的证据。所以既没有
确证根因，也没有排除它。

PR 已关闭，没有带着一个会让安装链失败的改动继续。

**下次要回答的问题**：为什么 feature-off 构建会让前端在 `main.tsx evaluated` 之后
停住。三个方向：

1. 某个前端启动路径在非 smoke 构建下仍会调用被门控的命令，而失败被吞掉了；
2. `terminal_smoke::setup()` 的替换改变了 `setup` 闭包的返回值语义；
3. 与门控无关——那次 runner 的问题，而本地恰好也无法验证。

第 3 条不能靠猜排除：需要在**能创建 DB 的环境**（有 GUI 会话的机器或 CI）上跑一次
feature-off 构建，才能把「我的改动」与「环境」分开。

### 未修 —— e2e-02 在 Linux 上的列数滞后

见 `48-e2e02-linux-column-lag.md`：两次修法（连续读数一致、几何交叉核对）都失败，
已回退，未放宽断言。
