# Team Server

Terminal 应用的团队协作服务端，支持自部署。

## 功能特性

- 🔐 **API Token 认证** - 安全的 API Token 认证机制
- 👥 **团队管理** - 创建、加入、管理团队
- 📤 **资源共享** - 共享主机和代码片段
- 🔗 **邀请系统** - 链接、邀请码、邮件三种邀请方式
- 📝 **审计日志** - 记录团队操作历史
- 🔄 **增量同步** - 高效的数据同步机制

## 快速开始

### 使用 Docker

```bash
# 创建 Compose 环境文件并替换数据库密码
cp .env.example .env

# 启动服务
docker compose up -d

# 查看日志
docker compose logs -f team-server

# 停止服务
docker compose down
```

### 本地开发

```bash
# 安装依赖
pnpm install --frozen-lockfile

# 宿主机开发连接本机 PostgreSQL，而不是 Compose 服务名 db
export DATABASE_URL=postgresql://terminal:<YOUR_PASSWORD>@127.0.0.1:5432/terminal

# 生成 Prisma Client
pnpm prisma:generate

# 运行数据库迁移
pnpm prisma:migrate

# 启动开发服务器
pnpm start:dev
```

### 生产部署

```bash
# 构建镜像
docker build -t terminal-team-server .

# 使用 Docker Compose 启动
docker compose up -d
```

## 环境变量

| 变量 | 描述 | Compose 示例 |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL 连接字符串 | `postgresql://terminal:<PASSWORD>@db:5432/terminal` |
| `POSTGRES_PASSWORD` | PostgreSQL 密码，首次启动前必须修改 | 无安全默认值 |
| `CORS_ORIGINS` | 允许的精确客户端 Origin，逗号分隔 | Tauri 本地 Origin |
| `PORT` | 容器内服务端口 | `3000` |
| `NODE_ENV` | 必填；只能精确设置为 `development`、`test` 或 `production` | `production` |
| `TEAM_SERVER_BIND_ADDRESS` | 主机发布端口的绑定地址 | `127.0.0.1` |
| `REGISTRATION_MODE` | `closed`、`token` 或 `open` | `closed` |
| `REGISTRATION_TOKEN` | token 模式的准入令牌，至少 32 字符 | 空，仅 token 模式必填 |

## 健康检查

```bash
# 服务健康状态
GET /api/v1/health

# K8s 存活探针
GET /api/v1/health/live

# K8s 就绪探针
GET /api/v1/health/ready
```

## API 文档

启动服务后访问: http://localhost:3000/api/docs

### 认证

```bash
# token 模式注册（成功后返回日常使用的 API Token）
curl -X POST http://127.0.0.1:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -H 'X-Registration-Token: <REGISTRATION_TOKEN>' \
  -d '{"userId":"your-uuid","name":"Your Name"}'

# 创建额外的 API Token（需要认证）
POST /api/v1/auth/tokens
Headers: Authorization: Bearer <token>
Body: { "name": "My Device" }

# 获取 Token 列表（需要认证）
GET /api/v1/auth/tokens
Headers: Authorization: Bearer <token>

# 撤销 Token（需要认证）
DELETE /api/v1/auth/tokens
Headers: Authorization: Bearer <token>
```

生产和 Compose 默认使用 `REGISTRATION_MODE=closed`，该模式拒绝所有新用户注册。`token` 适合受控设备开户：管理员通过携带注册准入令牌的请求领取初始 API Token，再将返回的 API Token 填入桌面端设置；不要把注册准入令牌当作日常 API Token 保存。`open` 会允许任意客户端注册，必须显式设置且只建议用于隔离的开发环境。

### 团队

```bash
# 创建团队
POST /api/v1/teams
Body: { "name": "My Team" }

# 获取我的团队
GET /api/v1/teams

# 获取团队详情
GET /api/v1/teams/:id

# 更新团队
PUT /api/v1/teams/:id
Body: { "name": "New Name" }

# 删除团队
DELETE /api/v1/teams/:id
```

### 邀请

```bash
# 创建邀请（链接）
POST /api/v1/teams/:teamId/invites
Body: { "type": "LINK", "role": "MEMBER" }

# 创建邀请（邀请码）
POST /api/v1/teams/:teamId/invites
Body: { "type": "CODE", "role": "ADMIN" }

# 通过邀请码加入
POST /api/v1/invites/join
Body: { "code": "TEAM-XXXX-XXXX" }
```

### 同步

```bash
# 获取增量更新
GET /api/v1/sync?since=1700000000000

# 推送本地更改
POST /api/v1/sync
Body: { "shares": [...] }
```

## 技术栈

- **框架**: NestJS 10.x
- **ORM**: Prisma 5.x
- **数据库**: PostgreSQL 16
- **API 文档**: Swagger/OpenAPI
- **容器**: Docker

## 项目结构

```
packages/team-server/
├── src/
│   ├── auth/          # 认证模块
│   ├── teams/         # 团队模块
│   ├── members/       # 成员模块
│   ├── shares/        # 共享模块
│   ├── invites/       # 邀请模块
│   ├── audit/         # 审计模块
│   ├── sync/          # 同步模块
│   └── prisma.service.ts
├── prisma/
│   └── schema.prisma  # 数据模型
├── Dockerfile
└── docker-compose.yml
```

## 许可证

MIT
