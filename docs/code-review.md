# 代码审查报告 - Terminal 项目

> 审查日期: 2026-03-25
> 审查范围: src/ 前端代码、package.json、eslint.config.js

---

## 一、项目架构问题

### 1.1 状态管理混用问题 🔴 严重

**问题描述**：项目同时使用了 **Zustand** 和 **MobX** 两种状态管理库。

| Store                               | 状态管理库            | 文件位置     |
| ----------------------------------- | --------------------- | ------------ |
| `app.ts`, `team.ts`, `workspace.ts` | Zustand               | `src/store/` |
| `host.ts`, `terminal.ts`            | MobX (但实为 Zustand) | `src/store/` |

**问题分析**：

1. `host.ts` 和 `terminal.ts` 使用 `create` from `zustand`，但 `types/index.ts` 注释提到 MobX
2. 两种状态管理库混用增加复杂度
3. MobX 和 Zustand 的响应式机制不同，维护困难

**影响**：

- 学习成本增加
- 状态同步逻辑复杂
- 可能出现响应式不一致问题

**建议**：统一迁移到 Zustand，移除 MobX 相关依赖。

**优先级**: P1

---

### 1.2 Team Store 过度膨胀 🔴 严重

**位置**: `src/store/team.ts`

**问题描述**：单个文件超过 1200 行，包含：

- 本地模式操作
- 云模式操作
- 两种模式的大量重复逻辑
- 类型转换函数
- 同步/异步操作混在一起

**代码行数统计**：

- 本地模式函数: ~50 个
- 云模式函数: ~20 个
- 类型转换函数: ~10 个

**建议拆分方案**：

```
src/store/teams/
├── index.ts           # 基础状态定义、初始 state
├── local.ts          # 本地模式操作 (shareHost, loadSharedHosts 等)
├── cloud.ts          # 云模式操作 (cloudCreateShare, sync 等)
├── types.ts          # 共享类型定义
└── converters.ts     # 类型转换函数 (toTeam, toTeamMember 等)
```

**优先级**: P0

---

## 二、代码逻辑漏洞与 Bug

### 2.1 数据库错误处理缺失 🟡 中等

**位置**: `src/service/database.ts`

```typescript:380:383:src/service/database.ts
export async function executeQuery(sql: string, params: unknown[] = []) {
  const database = await getDb()
  return database.execute(sql, params)
  // ⚠️ 没有任何错误处理！SQL 错误会直接抛出
}
```

**问题**：

- SQL 执行失败时无错误处理
- 调用方无法区分成功/失败
- 可能导致应用崩溃

**修复建议**：

```typescript
export async function executeQuery(sql: string, params: unknown[] = []) {
  try {
    const database = await getDb()
    return await database.execute(sql, params)
  } catch (error) {
    console.error('Database query error:', { sql, params, error })
    throw new Error(
      `Database query failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

export async function select<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const database = await getDb()
    return await database.select<T[]>(sql, params)
  } catch (error) {
    console.error('Database select error:', { sql, params, error })
    return [] // 或抛出错误，视业务需求
  }
}
```

**优先级**: P2

---

### 2.2 并发连接日志更新竞态条件 🟡 中等

**位置**: `src/service/ssh.ts`

```typescript:138:153:src/service/ssh.ts
async disconnect(sessionId: string): Promise<void> {
  await invoke('ssh_disconnect', { sessionId })
  const logInfo = activeConnectionLogs.get(sessionId)
  if (logInfo) {
    const endTime = Date.now()
    const durationSeconds = Math.round((endTime - logInfo.startTime) / 1000)
    await import('@/service/database').then(({ updateConnectionLog }) => {
      // ⚠️ 动态 import 不是最佳实践
      updateConnectionLog(logInfo.logId, {
        ended_at: endTime,
        duration_seconds: durationSeconds,
      })
    })
    activeConnectionLogs.delete(sessionId)
  }
}
```

**问题**：

1. 使用动态 `import()` 不是最佳实践，应在文件顶部静态导入
2. 没有错误处理，数据库更新失败会导致日志不完整
3. `activeConnectionLogs` 是内存 Map，刷新页面会丢失数据

**修复建议**：

```typescript
import { updateConnectionLog } from '@/service/database'  // 静态导入

async disconnect(sessionId: string): Promise<void> {
  try {
    await invoke('ssh_disconnect', { sessionId })
    const logInfo = activeConnectionLogs.get(sessionId)
    if (logInfo) {
      const endTime = Date.now()
      const durationSeconds = Math.round((endTime - logInfo.startTime) / 1000)
      await updateConnectionLog(logInfo.logId, {
        ended_at: endTime,
        duration_seconds: durationSeconds,
      })
      activeConnectionLogs.delete(sessionId)
    }
  } catch (error) {
    console.error('Disconnect error:', error)
  }
}
```

**优先级**: P1

---

### 2.3 React 依赖数组问题 🟡 中等

**位置**: `src/hooks/use-terminal.ts`

```typescript:284:284:src/hooks/use-terminal.ts
}, [term, tabType, startShell, sendData, resize, disconnect])
```

**问题**：回调函数作为依赖项会导致 effect 频繁重新执行。

**原因分析**：

- `startShell`, `sendData`, `resize`, `disconnect` 在每次渲染时使用 `useCallback` 重新创建
- 虽然有 `useCallback` 包裹，但依赖变化仍会触发 effect

**优化建议**：使用 refs 存储回调函数：

```typescript
const sendDataRef = useRef(sendData)
const resizeRef = useRef(resize)
const disconnectRef = useRef(disconnect)

useEffect(() => {
  sendDataRef.current = sendData
  resizeRef.current = resize
  disconnectRef.current = disconnect
}, [sendData, resize, disconnect])

useEffect(() => {
  // 使用 ref.current 而不是直接使用回调
}, [term, tabType, startShell]) // 移除频繁变化的依赖
```

**优先级**: P2

---

## 三、代码重复与可优化点

### 3.1 Host ID 生成方式不统一 🟡 中等

**问题描述**：项目中存在两种 ID 生成方式。

**使用 Math.random() (不推荐)**:

```typescript:src/store/host.ts:5:7
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}
```

**使用 crypto.randomUUID() (正确)**:

```typescript:src/view/hosts/index.tsx:113
id: crypto.randomUUID(),
```

**问题**：

- `Math.random()` 不是真正的随机，碰撞概率较高
- 不符合安全最佳实践
- 代码风格不统一

**建议**：统一使用 `crypto.randomUUID()`

```typescript
// src/utils/id.ts
export function generateId(): string {
  return crypto.randomUUID()
}

// 或使用短 ID (如果需要)
export function generateShortId(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 12)
}
```

**优先级**: P2

---

### 3.2 数据库类型转换重复 🟡 中等

**位置**: `src/service/database.ts`

**问题描述**：存在大量重复的类型转换函数。

```typescript
function rowToHost(row: HostRow): Host { ... }      // ~20 行
function rowToGroup(row: GroupRow): Group { ... }    // ~15 行
function rowToTeam(record: TeamRecord): Team { ... } // ~15 行
// ... 还有十几个类似函数
```

**建议**：抽象出通用的 RowMapper 工具函数。

```typescript
// src/utils/mapper.ts
type Mapper<TFrom, TTo> = (row: TFrom) => TTo

function createMapper<TFrom, TTo>(
  mapping: Partial<Record<keyof TTo, keyof TFrom>>,
): Mapper<TFrom, TTo> {
  return row => {
    const result = {} as TTo
    for (const [toKey, fromKey] of Object.entries(mapping)) {
      if (fromKey && fromKey in row) {
        result[toKey as keyof TTo] = row[fromKey as keyof TFrom] as any
      }
    }
    return result
  }
}

// 使用示例
const hostMapper = createMapper<HostRow, Host>({
  id: 'id',
  name: 'name',
  hostname: 'hostname',
  authType: 'auth_type', // 特殊转换可单独处理
})
```

**优先级**: P3

---

## 四、安全问题

### 4.1 密码明文存储风险 🔴 严重

**位置**:

- `src/types/index.ts:36` - `password?: string`
- `src/service/database.ts` - `hosts` 表存储密码

**问题描述**：

1. SSH 密码和私钥密码以明文存储在 SQLite 中
2. 数据库文件泄露 = 所有密码泄露
3. 刷新页面后密码可能仍保留在内存中

**风险等级**: 高

**建议措施**：

1. **短期**：使用系统 Keychain 存储敏感数据
   - Windows: 使用 Tauri 的 `tauri-plugin-store` 或原生 Keychain API
   - macOS: 使用 Keychain Services

2. **中期**：使用 tauri-plugin-sql 的加密扩展
   - 使用 SQLCipher 替代 SQLite
   - 或在应用层加密后再存储

3. **长期**：完善 Vault 功能
   - 主密码解锁
   - 敏感字段 AES-256-GCM 加密

**优先级**: P0

---

### 4.2 API Token 存储 🟡 中等

**位置**: `src/store/team.ts`

```typescript:839:846:src/store/team.ts
if (settings.apiToken) {
  teamApi.configure(settings.endpoint, settings.apiToken, ...)
}
```

**问题**：API Token 直接存储在 SQLite，未加密。

**建议**：

- 使用与密码相同的加密策略
- 限制 Token 的权限范围
- 定期轮换 Token

**优先级**: P1

---

### 4.3 SQL 注入风险 (潜在) 🟡 中等

**位置**: `src/service/database.ts`

```typescript:445:449:src/service/database.ts
export async function searchCommandHistory(query: string, limit = 20) {
  return database.select(
    'SELECT * FROM command_history WHERE command LIKE ? ORDER BY executed_at DESC LIMIT ?',
    [`%${query}%`, limit],  // ⚠️ query 直接拼接
  )
}
```

**问题分析**：

- 使用了参数化查询 `?`，这是正确的
- 但 LIKE 查询的 `%` 包装在参数中，可能有边缘情况

**建议**：虽然当前实现是安全的，但建议添加输入验证：

```typescript
export async function searchCommandHistory(query: string, limit = 20) {
  // 转义特殊 LIKE 字符，防止 ReDoS 攻击
  const escapedQuery = query.replace(/[%_]/g, '\\$&')
  return database.select(
    'SELECT * FROM command_history WHERE command LIKE ? ESCAPE "\\" ORDER BY executed_at DESC LIMIT ?',
    [`%${escapedQuery}%`, Math.min(limit, 100)], // 限制最大数量
  )
}
```

**优先级**: P3

---

## 五、性能问题

### 5.1 终端数据流无缓冲 🟡 中等

**位置**: `src/hooks/use-terminal.ts`

```typescript:213:220:src/hooks/use-terminal.ts
const unlistenData = await listen<ShellOutput>(
  `${eventPrefix}-data`,
  event => {
    termRef.current?.write(output.data)  // ⚠️ 每次都直接写入
  },
)
```

**问题**：在高延迟网络（如卫星链路、移动网络）下，频繁的小数据写入会导致性能问题。

**优化建议**：实现简单的缓冲写入：

```typescript
let writeBuffer = ''
let flushTimeout: ReturnType<typeof setTimeout> | null = null

const flushBuffer = () => {
  if (writeBuffer && termRef.current) {
    termRef.current.write(writeBuffer)
    writeBuffer = ''
  }
  flushTimeout = null
}

const unlistenData = await listen<ShellOutput>(`${eventPrefix}-data`, event => {
  writeBuffer += event.payload.data
  if (!flushTimeout) {
    flushTimeout = setTimeout(flushBuffer, 16) // ~60fps
  }
})
```

**优先级**: P2

---

### 5.2 大列表无虚拟化 🟡 中等

**位置**: `src/view/hosts/index.tsx`

```typescript:592:662:src/view/hosts/index.tsx
{filteredHosts.map((host, index) => (
  // ⚠️ 1000+ 主机会有性能问题
))}
```

**问题**：

- 渲染所有主机，DOM 节点过多
- 滚动卡顿
- 内存占用高

**建议**：使用虚拟列表库如 `react-virtual` 或 `tanstack/virtual`

```typescript
import { useVirtualizer } from '@tanstack/react-virtual'

const virtualizer = useVirtualizer({
  count: filteredHosts.length,
  getScrollElement: () => scrollContainerRef.current,
  estimateSize: () => 80,  // 每项预估高度
})

return (
  <div ref={scrollContainerRef} className="h-full overflow-auto">
    <div style={{ height: `${virtualizer.getTotalSize()}px` }}>
      {virtualizer.getVirtualItems().map(virtualRow => (
        <div
          key={filteredHosts[virtualRow.index].id}
          style={{
            position: 'absolute',
            top: 0,
            transform: `translateY(${virtualRow.start}px)`,
          }}
        >
          {/* 渲染单个主机 */}
        </div>
      ))}
    </div>
  </div>
)
```

**优先级**: P3

---

## 六、TypeScript 类型问题

### 6.1 类型导出不清晰 🟡 中等

**位置**: `src/service/database.ts`

```typescript:src/service/database.ts
// Re-export types for convenience
export type { Host, SSHOutput }
```

**问题**：

- `Host` 类型实际定义在 `types/index.ts`
- `database.ts` 重新导出但无注释说明
- 可能导致类型定义分散，难以追踪

**建议**：

1. 移除重复导出，统一从 `types/index.ts` 导入
2. 或在注释中明确说明类型来源

```typescript
// 移除此行，从 types/index.ts 直接导入
// export type { Host, SSHOutput }
```

**优先级**: P3

---

### 6.2 泛型类型推断问题 🟡 低

**位置**: `src/store/terminal.ts`

```typescript:29:29:src/store/terminal.ts
sessions: new Map(),  // ⚠️ 缺少类型参数
```

**建议**：

```typescript
sessions: new Map<string, TerminalSession>(),
```

**优先级**: P3

---

## 七、项目配置问题

### 7.1 ESLint 配置过于宽松 🟡 中等

**位置**: `eslint.config.js`

```javascript:eslint.config.js
'@typescript-eslint/no-explicit-any': 'off',       // ⚠️ 应警告
'@typescript-eslint/consistent-type-imports': 'off',  // ⚠️ 应启用
'@typescript-eslint/ban-ts-comment': 'warn',       // 良好
```

**建议调整**：

```javascript
'@typescript-eslint/no-explicit-any': 'warn',      // 改为警告
'@typescript-eslint/consistent-type-imports': ['error', {
  prefer: 'type-imports',
  fixStyle: 'inline',
}],
```

**优先级**: P3

---

### 7.2 package.json 中未使用的依赖 🟡 中等

**位置**: `package.json`

```json:package.json
"mobx": "^6.15.0",                    // ⚠️ 实际未使用
"mobx-react": "^9.2.1",               // ⚠️ mobx-react-lite 已足够
"mobx-react-lite": "^4.1.1",         // ⚠️ 可能未使用
"tsyringe": "^4.10.0",                // ⚠️ 未在代码中使用
"reflect-metadata": "^0.2.2",          // ⚠️ tsyringe 依赖但未启用
```

**依赖使用情况**：

| 依赖                                    | 状态   | 建议 |
| --------------------------------------- | ------ | ---- |
| `mobx`, `mobx-react`, `mobx-react-lite` | 未使用 | 移除 |
| `tsyringe`, `reflect-metadata`          | 未使用 | 移除 |

**执行命令**：

```bash
# 检查实际使用情况
grep -r "from 'mobx'" src/
grep -r "from 'mobx-react'" src/
grep -r "from 'tsyringe'" src/

# 移除未使用的依赖
pnpm remove mobx mobx-react mobx-react-lite tsyringe reflect-metadata
```

**优先级**: P2

---

## 八、问题优先级汇总

| 优先级 | 问题               | 影响       | 工作量 | 状态   |
| ------ | ------------------ | ---------- | ------ | ------ |
| **P0** | 密码明文存储       | 安全性     | 中     | 待修复 |
| **P0** | team.ts 过度膨胀   | 可维护性   | 高     | 待修复 |
| **P1** | 状态管理不统一     | 可维护性   | 中     | 待修复 |
| **P1** | 连接日志内存 Map   | 数据完整性 | 低     | 待修复 |
| **P1** | API Token 存储     | 安全性     | 低     | 待修复 |
| **P2** | SQL 错误处理缺失   | 健壮性     | 低     | 待修复 |
| **P2** | 终端数据流无缓冲   | 性能       | 中     | 待修复 |
| **P2** | Host ID 生成不统一 | 一致性     | 低     | 待修复 |
| **P2** | 未使用依赖         | 包体积     | 低     | 待修复 |
| **P3** | 大列表无虚拟化     | 性能       | 中     | 待规划 |
| **P3** | ESLint 配置宽松    | 代码质量   | 低     | 待优化 |
| **P3** | 类型导出不清晰     | 可维护性   | 低     | 待优化 |

---

## 九、代码拆分建议

### 9.1 `src/service/` 目录重构

**当前结构**：

```
src/service/
├── database.ts   # 1800+ 行，所有数据库操作
├── ssh.ts
├── serial.ts
├── config.ts
├── scripts.ts
├── sync.ts
├── team-api.ts
├── terminal-emitter.ts
└── vault.ts
```

**建议结构**：

```
src/service/
├── database/
│   ├── index.ts           # 统一导出
│   ├── connection.ts      # getDb, initSchema
│   ├── hosts.ts           # 主机 CRUD
│   ├── snippets.ts        # Snippet CRUD
│   ├── keys.ts            # SSH Key CRUD
│   ├── teams.ts           # 团队数据 CRUD
│   ├── scripts.ts          # 脚本 CRUD
│   └── types.ts           # 数据库相关类型
├── ssh.ts                 # 保持不变
├── serial.ts              # 保持不变
├── config.ts              # 保持不变
├── sync.ts                # 保持不变
├── team-api.ts            # 保持不变
├── terminal-emitter.ts    # 保持不变
└── vault.ts               # 保持不变
```

### 9.2 `src/store/teams/` 目录重构

**建议结构**：

```
src/store/teams/
├── index.ts           # 基础状态定义、初始 state、选择器
├── local.ts           # 本地模式操作
├── cloud.ts           # 云模式操作
├── types.ts           # 共享类型定义
└── converters.ts      # 类型转换函数
```

**文件大小目标**：

- 单文件不超过 300 行
- 每个文件职责单一

---

## 十、推荐的快速修复

### 10.1 添加数据库错误处理

```typescript
// src/service/database.ts

export async function executeQuery(sql: string, params: unknown[] = []) {
  try {
    const database = await getDb()
    return await database.execute(sql, params)
  } catch (error) {
    console.error('[Database] Query error:', {
      sql: sql.substring(0, 100),
      params,
      error: error instanceof Error ? error.message : String(error),
    })
    throw new Error(`Database query failed`)
  }
}

export async function select<T>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const database = await getDb()
    return await database.select<T[]>(sql, params)
  } catch (error) {
    console.error('[Database] Select error:', {
      sql: sql.substring(0, 100),
      params,
      error: error instanceof Error ? error.message : String(error),
    })
    return []
  }
}
```

### 10.2 统一 ID 生成

```typescript
// src/utils/id.ts

/**
 * 生成符合 RFC 4122 的 UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID()
}

/**
 * 生成短 ID (12 字符十六进制)
 * 适用于需要较短 ID 的场景
 */
export function generateShortId(): string {
  return crypto.randomUUID().replace(/-/g, '').substring(0, 12)
}

/**
 * 生成带前缀的 ID
 */
export function generatePrefixedId(prefix: string): string {
  return `${prefix}_${generateId()}`
}
```

### 10.3 静态导入替代动态导入

```typescript
// src/service/ssh.ts

// 文件顶部静态导入
import { updateConnectionLog } from '@/service/database'

// 移除函数内的动态 import
```

### 10.4 清理未使用的依赖

```bash
# 检查依赖使用情况
pnpm why mobx
pnpm why tsyringe

# 移除确认未使用的依赖
pnpm remove mobx mobx-react mobx-react-lite tsyringe reflect-metadata
```

---

## 十一、修复记录

### 2026-03-25 已完成的修复

| 状态      | 问题            | 修复内容                                                         |
| --------- | --------------- | ---------------------------------------------------------------- |
| ✅ 已修复 | 清理未使用依赖  | 确认 `mobx`, `mobx-react`, `tsyringe`, `reflect-metadata` 未使用 |
| ✅ 已修复 | ID 生成不统一   | 创建 `src/utils/id.ts`，统一使用 `crypto.randomUUID()`           |
| ✅ 已修复 | 数据库错误处理  | 修复 `executeQuery` 和 `select` 函数，添加 try-catch             |
| ✅ 已修复 | 动态导入问题    | 修复 `ssh.ts`，改为静态导入 `updateConnectionLog`                |
| ✅ 已修复 | ESLint 配置宽松 | 启用 `consistent-type-imports`，优化规则                         |
| ✅ 已修复 | 数据库模块拆分  | 创建 `src/service/database/` 模块结构                            |
| ✅ 已修复 | RowMapper 工具  | 创建 `src/utils/mapper.ts`，提供通用映射函数                     |
| ✅ 已修复 | store 使用新 ID | 更新 `store/host.ts` 和 `store/workspace.ts` 使用新工具          |

### 新增文件

```
src/
├── utils/
│   ├── id.ts         # 统一 ID 生成工具
│   └── mapper.ts     # 数据库行映射工具
└── service/
    └── database/
        ├── index.ts           # 模块导出
        ├── types.ts           # 数据库类型定义
        ├── connection.ts      # 数据库连接
        ├── hosts.ts           # Host CRUD
        ├── groups.ts          # Group CRUD
        ├── settings.ts        # 设置操作
        ├── command-history.ts # 命令历史
        ├── known-hosts.ts     # 已知主机
        ├── snippets.ts        # 代码片段
        ├── ssh-keys.ts       # SSH 密钥
        ├── workspaces.ts     # 工作区
        ├── connection-logs.ts # 连接日志
        ├── scripts.ts         # 脚本
        └── teams.ts           # 团队
```

### 待处理问题

| 优先级 | 问题             | 状态   |
| ------ | ---------------- | ------ |
| P0     | 密码明文存储     | 待评估 |
| P0     | Team Store 重构  | 待处理 |
| P1     | 状态管理统一     | 待处理 |
| P1     | 连接日志内存 Map | 待处理 |
| P1     | API Token 安全   | 待处理 |
| P2     | 终端数据流缓冲   | 待优化 |
| P3     | 大列表虚拟化     | 待优化 |

---

## 十二、后续跟进

- [ ] 密码加密存储方案评估
- [ ] Team Store 重构计划
- [ ] 状态管理统一方案
- [ ] 性能优化优先级确认

---

_报告生成时间: 2026-03-25_
_最后更新: 2026-03-25_
_审查者: Claude Code Assistant_
