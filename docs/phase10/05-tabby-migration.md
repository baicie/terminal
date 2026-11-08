# Phase 10 — 从 Tabby / OpenSSH 迁移

## 已实现（第一期：OpenSSH config）

代码：`packages/frontend/src/features/import/`

| 文件 | 职责 |
| --- | --- |
| `ssh-config-parser.ts` | 解析 `~/.ssh/config` 文本，产出 hosts 与 warnings |
| `import-plan.ts` | 生成可审查的导入计划：去重、校验、稳定 id、物化行 |
| `*.test.ts` | 42 项测试（解析 24 + 计划 18） |

### 支持

- `Host` 块（含一行多别名）
- `HostName`（含 IPv6 字面量 `[2001:db8::1]` 与裸形式）
- `User`、`Port`、`IdentityFile`、`ProxyJump`
- `Key value` 与 `Key=value` 两种写法
- 注释与空行
- 同名关键字重复时取第一个（OpenSSH 规则）

### 明确不支持（并给出警告，不猜测）

| 构造 | 处理 |
| --- | --- |
| `Include` | 不跟随；只读用户选中的那一个文件 |
| `Host web-*` 通配符 | 不展开；"模式不是主机"，展开等于凭空造主机 |
| `LocalForward` / `RemoteForward` / `DynamicForward` / `ForwardAgent` 等 | 列为一等警告，导入后用户自查 |
| 未知关键字 | 警告并忽略 |
| 非法端口 | 警告并回落 22 |

### 安全约束（已实现并被测试锁定）

1. **不覆盖**：按目标（host+port+user）与名称双重去重，重复项默认不勾选且不可物化；
2. **幂等**：id 由目标确定性派生（`import-<host>-<port>-<user>`），同一文件导入两次
   第二次 creatable = 0；
3. **私钥只引用不复制**：`IdentityFile` 作为路径写进 `privateKey` 字段（连接时读取），
   `JSON.stringify(row)` 断言不含 `BEGIN`；
4. **不改写文件**：解析器只读文本，不执行 shell、不解析 DNS、不访问网络；
5. 恶意/异常输入不抛异常：含二进制字节、未闭合引号、超长行、只有空白的文件均有测试。

## 为什么没有 Tabby 格式导入

Tabby 的配置是它自己的 SQLite / JSON 结构，且随版本变化；本项目**没有**取得一个
有稳定公开规范的导出格式样本。

按任务书要求："如 Tabby 当前导出格式无法安全解析，提供明确的支持范围和转换指南，
而不是猜格式导入。"

因此：

- `TABBY_IMPORT_SUPPORTED_SCOPE = NOT_RUN`（未实现，不是失败）
- 推荐路径：在 Tabby 中导出/查看连接，或直接用 `~/.ssh/config`
  （Tabby 也会读取它），再用本导入器导入。

## 未完成

- 导入向导 UI（当前只有解析与计划两层，未接 `file dialog` 与预览界面）；
- Tabby 格式；
- 导入后的"恢复点"提示文案（数据层已具备 `db_recovery` 快照能力）。

## 验收判定

| 项 | 判定 | 依据 |
| --- | --- | --- |
| `OPENSSH_CONFIG_IMPORT` | **PASS**（解析+计划层） | 42 项测试；UI 接入未做，见下 |
| `TABBY_IMPORT_SUPPORTED_SCOPE` | **NOT_RUN** | 未实现，理由如上 |
| `IMPORT_PREVIEW_AND_ROLLBACK` | **PARTIAL** | 预览数据齐备（candidates/warnings/summary）；回滚依赖既有 db_recovery，UI 未接 |
| `IMPORT_IDEMPOTENCE` | **PASS** | 同一文件二次导入 creatable=0 |
