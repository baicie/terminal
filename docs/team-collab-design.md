# 团队协作功能设计方案

> 更新时间：2026-03-25

---

## 目录

| 章节                                        | 内容                          |
| ------------------------------------------- | ----------------------------- |
| [一、整体架构](#一整体架构)                 | 本地模式与云端模式概述        |
| [二、数据格式设计](#二数据格式设计)         | JSON 包格式与数据库表结构     |
| [三、功能模块设计](#三功能模块设计)         | 本地模式和云端模式功能        |
| [四、API 设计](#四api-设计)                 | REST API 端点设计             |
| [五、前端 UI 设计](#五前端-ui-设计)         | 界面布局与交互                |
| [六、用户模式区分设计](#六用户模式区分设计) | 普通用户与团队用户区分        |
| [七、后端服务设计](#七后端服务设计)         | NestJS 服务端实现             |
| [八、实现计划](#八实现计划)                 | 开发阶段与任务分解            |
| [九、优先级建议](#九优先级建议)             | 任务优先级排序                |
| [十、关键设计决策](#十关键设计决策)         | 用户认证/邀请机制/权限/同步等 |

---

## 一、整体架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Terminal 应用                                │
├─────────────────────┬───────────────────────────────────────────────┤
│      本地模式        │                  云端模式                      │
│  ┌───────────────┐  │   ┌─────────────────────────────────────────┐ │
│  │ JSON 导入/导出 │  │   │         自部署云端服务                    │ │
│  │               │  │   │   ┌─────────┐    ┌──────────────────┐   │ │
│  │ • 导出团队包   │  │   │   │ REST API│◄──►│   PostgreSQL     │   │ │
│  │ • JSON 文件   │  │   │   │         │    │   (团队数据)      │   │ │
│  │ • 导入合并    │  │   │   │ /teams  │    └──────────────────┘   │ │
│  └───────────────┘  │   │   │ /members│                          │ │
│                      │   │   │ /shares │                          │ │
│                      │   │   └─────────┘                          │ │
│                      │   └─────────────────────────────────────────┘ │
└─────────────────────┴───────────────────────────────────────────────┘
```

---

## 二、数据格式设计

### 2.1 本地模式（JSON 包格式）

团队配置导出为独立的 JSON 文件，方便离线分享：

```json
{
  "version": "1.0",
  "teamName": "DevOps Team",
  "exportedAt": "2026-03-25T10:00:00Z",
  "exportedBy": "user-uuid",
  "members": [
    {
      "id": "uuid",
      "name": "张三",
      "email": "zhangsan@example.com",
      "role": "admin"
    }
  ],
  "hosts": [
    {
      "id": "uuid",
      "name": "生产服务器",
      "hostname": "192.168.1.100",
      "port": 22,
      "username": "admin",
      "authType": "password",
      "groupId": "group-uuid",
      "sharedBy": "uuid",
      "permission": "readonly"
    }
  ],
  "groups": [...],
  "snippets": [...],
  "settings": {...}
}
```

### 2.2 云端模式（服务端数据库）

#### 数据库表结构

```sql
-- 团队表
CREATE TABLE teams (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    owner_id UUID NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 团队成员表
CREATE TABLE team_members (
    id UUID PRIMARY KEY,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    user_name VARCHAR(255),
    user_email VARCHAR(255),
    role VARCHAR(20) CHECK (role IN ('admin', 'member')),
    joined_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(team_id, user_id)
);

-- 共享主机表
CREATE TABLE shared_hosts (
    id UUID PRIMARY KEY,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    host_data JSONB NOT NULL,  -- 完整主机配置
    shared_by UUID NOT NULL,   -- 分享者
    permission VARCHAR(20) CHECK (permission IN ('readonly', 'readwrite')),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 共享 Snippet 包表
CREATE TABLE shared_snippet_packages (
    id UUID PRIMARY KEY,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    package_data JSONB NOT NULL,
    shared_by UUID NOT NULL,
    permission VARCHAR(20) CHECK (permission IN ('readonly', 'readwrite')),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 连接审计日志表
CREATE TABLE team_audit_logs (
    id UUID PRIMARY KEY,
    team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    user_name VARCHAR(255),
    host_name VARCHAR(255),
    action VARCHAR(50),  -- connect, disconnect, command
    details JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);
```

---

## 三、功能模块设计

### 3.1 本地模式功能

| 功能       | 描述                                           |
| ---------- | ---------------------------------------------- |
| 导出团队包 | 将选中的主机/分组/Snippet 导出为 JSON 文件     |
| 导入团队包 | 导入 JSON 文件，支持合并策略（新建/覆盖/询问） |
| 团队包预览 | 导入前预览包含的内容                           |

### 3.2 云端模式功能

| 功能     | 描述                            |
| -------- | ------------------------------- |
| 服务配置 | 设置服务端点（自部署 URL）      |
| 用户认证 | API Token 认证                  |
| 团队管理 | 创建/加入/退出团队              |
| 成员管理 | 添加/移除成员，设置角色         |
| 共享管理 | 共享主机/分组/Snippet，设置权限 |
| 实时同步 | 自动同步团队共享的配置          |
| 审计日志 | 查看团队成员的连接记录          |

---

## 四、API 设计

### 4.1 基础配置

```typescript
interface CloudConfig {
  endpoint: string // 服务端点，如 https://team.example.com
  apiToken: string // API Token
  autoSync: boolean // 是否自动同步
  syncInterval: number // 同步间隔（秒）
}
```

### 4.2 REST API 端点

| 方法   | 端点                                  | 描述                 |
| ------ | ------------------------------------- | -------------------- |
| GET    | `/api/v1/teams`                       | 获取我的团队列表     |
| POST   | `/api/v1/teams`                       | 创建团队             |
| GET    | `/api/v1/teams/:id`                   | 获取团队详情         |
| PUT    | `/api/v1/teams/:id`                   | 更新团队             |
| DELETE | `/api/v1/teams/:id`                   | 删除团队             |
| GET    | `/api/v1/teams/:id/members`           | 获取团队成员         |
| POST   | `/api/v1/teams/:id/members`           | 添加成员             |
| DELETE | `/api/v1/teams/:id/members/:userId`   | 移除成员             |
| GET    | `/api/v1/teams/:id/shares`            | 获取共享资源         |
| POST   | `/api/v1/teams/:id/shares`            | 共享资源             |
| DELETE | `/api/v1/teams/:id/shares/:shareId`   | 取消共享             |
| GET    | `/api/v1/teams/:id/shares/:shareId`   | 获取共享详情         |
| GET    | `/api/v1/teams/:id/audit`             | 获取审计日志         |
| POST   | `/api/v1/teams/:id/invites`           | 创建邀请             |
| GET    | `/api/v1/teams/:id/invites`           | 获取邀请列表         |
| DELETE | `/api/v1/teams/:id/invites/:inviteId` | 取消邀请             |
| GET    | `/api/v1/invites/:token`              | 通过邀请链接加入     |
| POST   | `/api/v1/invites/join`                | 通过邀请码或链接加入 |
| POST   | `/api/v1/sync`                        | 增量同步数据         |

---

## 五、前端 UI 设计

### 5.1 团队协作视图 (`/teams`)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Teams                                            [+ New Team]      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 🔷 DevOps Team                          Admin · 3 members   │   │
│  │    自部署服务: https://team.example.com                     │   │
│  │    [Sync Now]  [Settings]  [Leave]                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 🔷 Backend Team                           Member · 5 members│   │
│  │    本地模式                                                   │   │
│  │    [Sync Now]  [Settings]  [Leave]                          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.2 团队详情页面

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back                    DevOps Team                    [Settings]│
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  [Members] [Shared Hosts] [Shared Snippets] [Audit Logs]           │
│                                                                     │
│  ┌─ Members ─────────────────────────────────────────────────────┐  │
│  │  👤 张三 (admin)                    zhangsan@example.com  [!] │  │
│  │  👤 李四 (member)                   lisi@example.com     [x] │  │
│  │  👤 王五 (member)                   wangwu@example.com   [x] │  │
│  │                                                                 │  │
│  │  [+ Invite Member]                                           │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 5.3 服务配置界面

```
┌─────────────────────────────────────────────────────────────────────┐
│  Service Configuration                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Connection Mode                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  ○ Local (JSON files)                                       │  │
│  │    Export/import team packages via JSON files               │  │
│  │                                                              │  │
│  │  ● Cloud (Self-hosted)                                       │  │
│  │    Connect to your own team server                           │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Server Endpoint                                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  https://team.example.com                                    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  API Token                                                         │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  ••••••••••••••••••••••                        [Show]        │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  Auto Sync                                                         │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  [✓] Enable auto sync                                       │  │
│  │  Sync interval: [30 seconds ▼]                              │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
│                              [Cancel]  [Save]                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 六、用户模式区分设计

### 6.1 两种用户模式

| 模式         | 说明           | 用户体验                            |
| ------------ | -------------- | ----------------------------------- |
| **普通用户** | 不使用团队功能 | 简洁界面，无团队相关入口            |
| **团队用户** | 启用团队功能   | 完整界面，显示 Teams 导航和团队设置 |

### 6.2 导航栏动态显示

```
┌─────────────────────────────────────────────────────────────────────┐
│                         普通用户模式                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 🏠 Hosts    🔑 Keychain    📡 Port Fwd    📝 Snippets      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  - 没有"Teams"入口                                                 │
│  - 设置中显示"启用团队功能"入口（引导创建）                          │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         团队用户模式                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 🏠 Hosts    👥 Teams    🔑 Keychain    📡 Port Fwd    📝   │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  - 左侧导航出现"Teams"入口                                          │
│  - 设置中显示"团队设置"                                              │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.3 代码实现

#### 6.3.1 状态管理

```typescript
// src/store/team.ts
interface TeamSettings {
  enabled: boolean // 是否启用团队功能
  mode: 'local' | 'cloud' // 本地模式 / 云端模式
  endpoint?: string // 云端服务端点
  apiToken?: string // API Token
  autoSync: boolean // 自动同步
  currentTeamId?: string // 当前团队 ID
}

class TeamStore {
  @observable settings: TeamSettings = {
    enabled: false,
    mode: 'local',
    autoSync: false,
  }

  @observable currentTeam: Team | null = null

  @computed get isTeamEnabled(): boolean {
    return this.settings.enabled
  }

  @computed get isCloudMode(): boolean {
    return this.settings.enabled && this.settings.mode === 'cloud'
  }

  @action enableTeamMode(config: Partial<TeamSettings>) {
    this.settings = { ...this.settings, ...config, enabled: true }
  }

  @action disableTeamMode() {
    this.settings = {
      enabled: false,
      mode: 'local',
      autoSync: false,
    }
    this.currentTeam = null
  }
}
```

#### 6.3.2 导航栏动态配置

```typescript
// src/components/app-sidebar/index.tsx
const getNavItems = (isTeamEnabled: boolean): NavItem[] => {
  const baseItems: NavItem[] = [
    { path: "/hosts", label: "Hosts", icon: <HomeIcon /> },
    { path: "/keychain", label: "Keychain", icon: <KeyIcon /> },
    { path: "/port-forward", label: "Port Fwd", icon: <RadioIcon /> },
    { path: "/snippets", label: "Snippets", icon: <CodeIcon /> },
    { path: "/logs", label: "Logs", icon: <FileTextIcon /> },
  ];

  if (isTeamEnabled) {
    baseItems.splice(1, 0, { path: "/teams", label: "Teams", icon: <UsersIcon /> });
  }

  return baseItems;
};

// 使用
const navItems = getNavItems(teamStore.isTeamEnabled);
```

#### 6.3.3 设置页面动态入口

```typescript
// src/components/settings-dialog/index.tsx
const SettingsNav: React.FC = () => {
  const { teamStore } = useStores();

  return (
    <div className="space-y-2">
      {/* 通用设置 */}
      <NavItem to="/settings/general" icon={<SettingsIcon />}>
        通用
      </NavItem>

      {/* 连接设置 */}
      <NavItem to="/settings/connection" icon={<PlugIcon />}>
        连接
      </NavItem>

      {/* 团队入口 */}
      {teamStore.isTeamEnabled ? (
        <NavItem to="/settings/team" icon={<UsersIcon />}>
          团队设置
        </NavItem>
      ) : (
        <NavItem to="/settings/team" icon={<UsersIcon />} className="text-primary">
          启用团队功能
        </NavItem>
      )}
    </div>
  );
};
```

### 6.4 启用流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                           启动应用                                   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────────┐
                    │  检查 app_settings.team_enabled   │
                    └───────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
           ┌──────────────┐              ┌──────────────────┐
           │   enabled    │              │   !enabled       │
           │   (团队用户)  │              │   (普通用户)      │
           └──────────────┘              └──────────────────┘
                    │                               │
                    ▼                               ▼
           ┌──────────────┐              ┌──────────────────┐
           │ 显示 Teams   │              │ 无 Teams 入口     │
           │ 导航项       │              │ 设置中显示        │
           └──────────────┘              │ "启用团队功能"    │
                    │                    └──────────────────┘
                    ▼                               │
           ┌──────────────┐                        │
           │ 用户选择：   │                        │
           │ 1. 本地模式   │                        │
           │ 2. 云端模式   │                        │
           └──────────────┘                        │
                    │                               │
                    ▼                               ▼
           ┌───────────────────────────────────┐   │
           │         正常工作                   │◀──┘
           │   (Hosts, Keychain, etc.)         │
           └───────────────────────────────────┘
```

### 6.5 数据存储

团队设置存储在本地 SQLite 数据库：

```sql
-- app_settings 表存储 JSON
INSERT INTO app_settings (key, value) VALUES
  ('team_settings', '{"enabled":false,"mode":"local","autoSync":false}');
```

---

## 七、后端服务设计

### 7.1 技术栈

| 组件     | 技术                          |
| -------- | ----------------------------- |
| Web 框架 | NestJS (Node.js / TypeScript) |
| ORM      | Prisma                        |
| 数据库   | PostgreSQL                    |
| 认证     | JWT / API Token               |
| 部署     | Docker                        |
| API 文档 | Swagger (OpenAPI)             |

### 7.2 项目结构

```
packages/team-server/
├── package.json
├── tsconfig.json
├── nest-cli.json
├── prisma/
│   └── schema.prisma      # Prisma 数据模型
├── src/
│   ├── main.ts            # 入口文件
│   ├── app.module.ts      # 根模块
│   ├── config/
│   │   └── configuration.ts # 配置模块
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── auth.controller.ts
│   │   ├── auth.service.ts
│   │   ├── strategies/
│   │   │   └── jwt.strategy.ts
│   │   └── guards/
│   │       └── jwt-auth.guard.ts
│   ├── teams/
│   │   ├── teams.module.ts
│   │   ├── teams.controller.ts
│   │   ├── teams.service.ts
│   │   ├── dto/
│   │   │   ├── create-team.dto.ts
│   │   │   └── update-team.dto.ts
│   │   └── entities/
│   │       └── team.entity.ts
│   ├── members/
│   │   ├── members.module.ts
│   │   ├── members.controller.ts
│   │   ├── members.service.ts
│   │   ├── dto/
│   │   │   └── add-member.dto.ts
│   │   └── entities/
│   │       └── member.entity.ts
│   ├── shares/
│   │   ├── shares.module.ts
│   │   ├── shares.controller.ts
│   │   ├── shares.service.ts
│   │   ├── dto/
│   │   │   └── create-share.dto.ts
│   │   └── entities/
│   │       └── share.entity.ts
│   └── audit/
│       ├── audit.module.ts
│       ├── audit.controller.ts
│       ├── audit.service.ts
│       └── entities/
│           └── audit-log.entity.ts
├── test/
│   └── app.e2e-spec.ts
├── Dockerfile
└── docker-compose.yml
```

### 7.3 Prisma 数据模型

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Team {
  id        String   @id @default(uuid())
  name      String
  ownerId   String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  members   TeamMember[]
  shares    Share[]
  auditLogs AuditLog[]
}

model TeamMember {
  id        String   @id @default(uuid())
  teamId    String
  team      Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  userId    String
  userName  String?
  userEmail String?
  role      Role     @default(MEMBER)
  joinedAt  DateTime @default(now())

  @@unique([teamId, userId])
}

enum Role {
  ADMIN
  MEMBER
}

model Share {
  id         String       @id @default(uuid())
  teamId     String
  team       Team         @relation(fields: [teamId], references: [id], onDelete: Cascade)
  type       ShareType
  data       Json
  sharedBy   String
  permission Permission   @default(READONLY)
  createdAt  DateTime     @default(now())
}

enum ShareType {
  HOST
  HOST_GROUP
  SNIPPET_PACKAGE
}

enum Permission {
  READONLY
  READWRITE
}

model AuditLog {
  id        String   @id @default(uuid())
  teamId    String
  team      Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)
  userId    String
  userName  String?
  hostName  String?
  action    String
  details   Json?
  createdAt DateTime @default(now())
}

model ApiToken {
  id        String   @id @default(uuid())
  userId    String   @unique
  token     String   @unique
  name      String?
  createdAt DateTime @default(now())
  expiresAt DateTime?
}

model Invite {
  id        String      @id @default(uuid())
  teamId    String
  type      InviteType
  code      String?     @unique   // 邀请码
  linkToken String?     @unique   // 邀请链接 token
  email     String?
  role      Role       @default(MEMBER)
  createdBy String
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime    @default(now())
}

enum InviteType {
  LINK
  CODE
  EMAIL
}
```

### 7.3 新增表：操作队列

```prisma
model SyncQueue {
  id         String   @id @default(uuid())
  userId     String
  teamId     String
  type       SyncOperationType
  resource   String
  resourceId String
  data       Json
  status     SyncStatus @default(PENDING)
  retryCount Int      @default(0)
  error      String?
  createdAt  DateTime @default(now())
  syncedAt   DateTime?
}

enum SyncOperationType {
  CREATE
  UPDATE
  DELETE
}

enum SyncStatus {
  PENDING
  SYNCING
  COMPLETED
  FAILED
}
```

### 7.4 Docker 部署

```yaml
# docker-compose.yml
version: '3.8'

services:
  team-server:
    build: packages/team-server
    ports:
      - '3000:3000'
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/team_db
      - JWT_SECRET=${JWT_SECRET}
      - JWT_EXPIRES_IN=7d
      - NODE_ENV=production
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped

  db:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
      - POSTGRES_DB=team_db
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U user -d team_db']
      interval: 5s
      timeout: 5s
      retries: 5
    restart: unless-stopped

volumes:
  pgdata:
```

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS production

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/main"]
```

---

## 八、实现计划

### Phase 1：基础框架

| 任务           | 描述                    |
| -------------- | ----------------------- |
| 团队数据模型   | 定义 TypeScript 类型    |
| 团队存储服务   | 本地 SQLite 存储        |
| 用户模式区分   | 普通/团队用户导航区分   |
| 团队协作视图   | 创建 TeamsView 页面组件 |
| 用户 UUID 生成 | 首次启动生成本地 UUID   |

### Phase 2：本地模式

| 任务     | 描述                 |
| -------- | -------------------- |
| 导出功能 | 导出团队包为 JSON    |
| 导入功能 | 导入 JSON 并处理合并 |
| 预览功能 | 导入前预览内容       |

### Phase 3：云端模式

| 任务         | 描述                           |
| ------------ | ------------------------------ |
| 服务配置 UI  | 配置服务端点和 Token           |
| API 服务端   | NestJS 实现 REST API           |
| 邀请功能     | 三种邀请方式（链接/码/邮箱）   |
| 同步功能     | 增量同步 + 冲突处理 + 离线队列 |
| 敏感数据加密 | 密码可选加密共享               |
| 审计日志     | 记录和展示连接历史             |

### Phase 4：团队服务端

| 任务        | 描述                      |
| ----------- | ------------------------- |
| 服务端项目  | 创建 team-server (NestJS) |
| Docker 部署 | 提供 docker-compose       |
| 数据备份    | 自动备份 + 手动导出       |

---

## 九、优先级建议

| 优先级 | 任务                            |
| ------ | ------------------------------- |
| P0     | 用户模式区分（导航动态显示）    |
| P0     | 本地导出/导入功能               |
| P0     | 用户 UUID 生成                  |
| P1     | 团队协作视图（TeamsView UI）    |
| P1     | 云端同步功能（增量 + 冲突处理） |
| P1     | 邀请机制（三种方式）            |
| P1     | 服务端实现 (NestJS)             |
| P2     | 敏感数据加密共享                |
| P2     | 离线操作队列                    |
| P2     | Docker 部署配置                 |
| P2     | 审计日志                        |
| P2     | 数据备份                        |

---

## 十、关键设计决策

### 10.1 用户标识与认证

| 设计点       | 方案                       |
| ------------ | -------------------------- |
| 用户 ID      | 本地首次启动时生成 UUID    |
| 团队成员标识 | 基于用户 UUID + 用户名     |
| API Token    | 手动输入或通过邀请链接获取 |

```typescript
// 本地生成用户 UUID
const generateUserId = (): string => {
  return crypto.randomUUID()
}

// 用户数据结构
interface LocalUser {
  id: string // 本地 UUID
  name: string // 用户名（可自定义）
  createdAt: Date // 创建时间
  teams: string[] // 所属团队 ID 列表
}
```

### 10.2 邀请机制

支持三种邀请方式，满足不同场景：

```
┌─────────────────────────────────────────────────────────────────────┐
│  邀请成员                                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─ 方式一：邀请链接 ─────────────────────────────────────────────┐  │
│  │  https://team.example.com/invite/abc123xyz                     │  │
│  │  任何人打开链接即可加入团队（适合公开团队）                      │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ 方式二：邀请码 ───────────────────────────────────────────────┐  │
│  │  团队管理员生成分享码                                            │  │
│  │  ┌──────────────────────────────────────────────────────┐     │  │
│  │  │  TEAM-XYZZ-1234                        [复制] [刷新] │     │  │
│  │  └──────────────────────────────────────────────────────┘     │  │
│  │  成员输入邀请码加入（适合私密团队）                             │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ 方式三：邮箱邀请 ─────────────────────────────────────────────┐  │
│  │  输入邮箱地址发送邀请邮件                                        │  │
│  │  ┌──────────────────────────────────────────────────────┐     │  │
│  │  │  邮箱: _______________________________________         │     │  │
│  │  │  角色: [Admin ▼] [Member ▼]                          │     │  │
│  │  └──────────────────────────────────────────────────────┘     │  │
│  │  邮件中包含邀请链接                                             │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

邀请码格式：`TEAM-{团队前缀}-{4位随机字符}`

```typescript
// 邀请码生成
const generateInviteCode = (teamSlug: string): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const random = Array.from(
    { length: 4 },
    () => chars[Math.floor(Math.random() * chars.length)],
  ).join('')
  return `TEAM-${teamSlug.toUpperCase()}-${random}`
}
```

### 10.3 权限模型

#### 角色权限

| 权限         | Owner | Admin |     Member     |
| ------------ | :---: | :---: | :------------: |
| 创建团队     |  ✅   |  ❌   |       ❌       |
| 删除团队     |  ✅   |  ❌   |       ❌       |
| 管理所有成员 |  ✅   |  ✅   |       ❌       |
| 移除成员     |  ✅   |  ✅   |       ❌       |
| 共享资源     |  ✅   |  ✅   | ✅（仅自己的） |
| 取消共享     |  ✅   |  ✅   | ✅（仅自己的） |
| 使用共享资源 |  ✅   |  ✅   |       ✅       |
| 查看审计日志 |  ✅   |  ✅   |       ❌       |
| 团队设置     |  ✅   |  ✅   |       ❌       |

#### 资源权限

| 权限级别  | 查看 | 连接 | 编辑 | 删除 |
| --------- | :--: | :--: | :--: | :--: |
| Readonly  |  ✅  |  ✅  |  ❌  |  ❌  |
| Readwrite |  ✅  |  ✅  |  ✅  |  ❌  |

### 10.4 敏感数据共享

> ⚠️ 默认不共享敏感认证信息，管理员可选择是否共享

| 数据类型       | 默认共享 | 可选加密 |
| -------------- | :------: | :------: |
| 主机名/IP/端口 |    ✅    |    -     |
| 用户名         |    ✅    |    -     |
| 密码           |    ❌    | ✅ 可选  |
| SSH 私钥       |    ❌    |    ❌    |
| SSH 公钥引用   |    ✅    |    -     |
| Snippet 内容   |    ✅    |    -     |

```typescript
// 共享主机时的敏感数据选项
interface ShareHostOptions {
  includePassword: boolean // 是否包含密码
  encryptPassword: boolean // 是否加密密码（可设置密码保护）
  passwordProtection?: string // 解密密码（如果加密）
}

// 加密方式：使用 AES-256-GCM
// 密钥由分享者设置，接收者需要输入密码解密
```

### 10.5 同步机制

#### 同步策略

| 策略     | 说明                                               |
| -------- | -------------------------------------------------- |
| 同步方式 | **增量同步**，基于 `updatedAt` 时间戳              |
| 冲突处理 | **询问用户**，用户可选择保留本地/服务端/两者都保留 |
| 离线支持 | **完整支持**，离线操作记录到队列，恢复后自动同步   |

```
┌─────────────────────────────────────────────────────────────────────┐
│  同步流程                                                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. 获取本地最后同步时间: lastSyncAt                                 │
│  2. 请求服务端变更: GET /api/v1/sync?since={lastSyncAt}             │
│  3. 检测冲突: 比较本地和服务端的 updatedAt                          │
│  4. 无冲突 → 直接应用                                                │
│  5. 有冲突 → 弹窗询问用户:                                          │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ⚠️ 检测到冲突                                               │   │
│  │                                                             │   │
│  │  主机 "生产数据库" 在本地和服务端都有修改                     │   │
│  │                                                             │   │
│  │  本地版本 (2026-03-25 10:00)                                │   │
│  │  ├ 用户名: admin                                            │   │
│  │  └ 端口: 3306                                               │   │
│  │                                                             │   │
│  │  服务端版本 (2026-03-25 09:30)                              │   │
│  │  ├ 用户名: root                                             │   │
│  │  └ 端口: 3307                                               │   │
│  │                                                             │   │
│  │  [保留本地]  [保留服务端]  [保留两者]  [查看差异]           │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  6. 离线操作队列:                                                    │
│     - 离线时的操作（共享、编辑等）记录到操作队列                      │
│     - 恢复网络后，按顺序执行队列中的操作                             │
│     - 失败时重试 3 次，超过则标记为手动处理                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

#### 离线操作队列

```typescript
// 操作队列结构
interface SyncQueueItem {
  id: string
  type: 'CREATE' | 'UPDATE' | 'DELETE'
  resource: 'host' | 'snippet' | 'share'
  data: any
  timestamp: Date
  retryCount: number
  status: 'pending' | 'syncing' | 'failed' | 'completed'
}

// 本地存储到 IndexedDB
const syncQueue = new SyncQueue('sync_queue')
```

### 10.6 共享主机的展示

Hosts 视图中区分「我的主机」和「团队共享」：

```
┌─────────────────────────────────────────────────────────────────────┐
│  Hosts                                              [+ Add Host]     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  🔷 我的主机                                                          │
│    ├ 🖥 生产服务器            192.168.1.100 · admin              ≡  │
│    ├ 🖥 开发服务器            192.168.1.101 · developer         ≡  │
│    └ 🖥 测试环境              192.168.1.102 · tester            ≡  │
│                                                                     │
│  🔷 来自团队的共享                        ↻ Sync                    │
│    ├ 👥 DevOps Team                                                   │
│    │  ├ 🖥 数据库主库 (readonly)                                   │
│    │  │   共享者: 张三 · 3天前                                      │
│    │  ├ 🖥 Redis 缓存     (readonly)                               │
│    │  │   共享者: 张三 · 3天前                                      │
│    │  └ 🖥 API 网关      (readwrite)                                │
│    │      共享者: 李四 · 1周前                                      │
│    └ 👥 Backend Team                                                 │
│       └ 🖥 代码服务器    (readonly)                                 │
│           共享者: 王五 · 2周前                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.7 团队数据备份

| 备份类型 | 说明                                   |
| -------- | -------------------------------------- |
| 自动备份 | 服务端每日凌晨执行 PostgreSQL 全量备份 |
| 备份保留 | 保留最近 30 天备份                     |
| 手动导出 | 管理员可随时导出团队完整 JSON 包       |
| 导入恢复 | 支持导入 JSON 包恢复数据               |

```typescript
// 导出团队包结构
interface TeamExport {
  version: '1.0'
  exportedAt: string
  exportedBy: string
  team: {
    id: string
    name: string
  }
  members: TeamMember[]
  shares: Share[]
  auditLogs?: AuditLog[] // 可选，包含或不包含审计日志
}

// 服务端备份存储路径
// /backups/team-{teamId}/backup-{date}.sql
```

---

## 十一、TODO 待办事项（同步自 `docs/todo.md`）

> 以下待办事项基于 `docs/todo.md` 整理，对应团队协作功能的开发计划。

### Phase 4 - 企业功能（团队协作相关）

#### 4.2 团队协作 📋 待开发

| 任务                | 描述                                   | 状态      | 优先级 |
| ------------------- | -------------------------------------- | --------- | ------ |
| 用户 UUID 生成      | 首次启动生成本地 UUID，用于标识用户    | 📋 待开发 | P0     |
| 团队数据模型        | 定义 TypeScript 类型和 SQLite 本地存储 | 📋 待开发 | P0     |
| 用户模式区分        | 普通/团队用户导航动态显示              | 📋 待开发 | P0     |
| 团队协作视图        | TeamsView 页面组件                     | 📋 待开发 | P1     |
| 本地导出功能        | 导出团队包为 JSON 文件                 | 📋 待开发 | P0     |
| 本地导入功能        | 导入 JSON 并处理合并策略               | 📋 待开发 | P0     |
| 预览功能            | 导入前预览内容                         | 📋 待开发 | P1     |
| 服务配置 UI         | 配置服务端点和 Token                   | 📋 待开发 | P1     |
| 邀请机制            | 三种邀请方式（链接/码/邮箱）           | 📋 待开发 | P1     |
| 云端同步功能        | 增量同步 + 冲突处理 + 离线队列         | 📋 待开发 | P1     |
| 敏感数据加密共享    | 密码可选加密共享                       | 📋 待开发 | P2     |
| 审计日志            | 记录和展示连接历史                     | 📋 待开发 | P2     |
| 服务端实现 (NestJS) | REST API 服务端                        | 📋 待开发 | P1     |
| Docker 部署配置     | 提供 docker-compose 部署               | 📋 待开发 | P2     |
| 数据备份            | 自动备份 + 手动导出                    | 📋 待开发 | P2     |

#### 4.3 SSH 证书认证 📋 待开发

| 任务     | 描述             | 状态      | 优先级 |
| -------- | ---------------- | --------- | ------ |
| 证书支持 | SSH 证书认证方式 | 📋 待开发 | P3     |
| 证书管理 | 颁发和管理证书   | 📋 待开发 | P3     |

### 技术依赖与前置任务

| 任务           | 说明                                       | 关联文档        |
| -------------- | ------------------------------------------ | --------------- |
| 用户 UUID 生成 | `app_settings` 表存储 `user_uuid` 字段     | 本文档 §十.10.1 |
| 团队存储服务   | SQLite 表设计参照本文档 §二.2              | 本文档 §二.2    |
| 导航动态显示   | `AppSidebar` 根据 `teamStore.enabled` 切换 | 本文档 §六.3    |
| 导出团队包     | JSON 格式参照本文档 §二.1                  | 本文档 §二.1    |
| 导入合并策略   | 支持 Merge/Replace 两种模式                | 本文档 §十.10.5 |
| 服务端 API     | REST 端点参照本文档 §四                    | 本文档 §四      |
| 同步机制       | 增量同步 + 冲突处理 + 离线队列             | 本文档 §十.10.5 |
| 邀请机制       | 三种邀请方式实现                           | 本文档 §十.10.2 |
| 敏感数据加密   | AES-256-GCM 加密共享密码                   | 本文档 §十.10.4 |
| 审计日志       | 记录团队成员的连接记录                     | 本文档 §十.10.7 |

### 实现优先级排序

| 优先级 | 任务                                                                      |
| ------ | ------------------------------------------------------------------------- |
| **P0** | 用户 UUID 生成、团队数据模型、用户模式区分、本地导出/导入功能             |
| **P1** | 团队协作视图（TeamsView UI）、云端同步功能、邀请机制、服务端实现 (NestJS) |
| **P2** | 敏感数据加密共享、离线操作队列、Docker 部署配置、审计日志、数据备份       |
| **P3** | SSH 证书认证、证书管理                                                    |

---

_文档更新时间：2026-03-25_
_最后更新：2026-03-25 - 同步 `docs/todo.md` TODO 待办事项_
