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
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f team-server

# 停止服务
docker-compose down
```

### 本地开发

```bash
# 安装依赖
npm install

# 生成 Prisma Client
npx prisma generate

# 运行数据库迁移
npx prisma migrate dev

# 启动开发服务器
npm run start:dev
```

### 生产部署

```bash
# 构建镜像
docker build -t terminal-team-server .

# 使用 docker-compose 启动
docker-compose up -d
```

## 环境变量

| 变量 | 描述 | 默认值 |
|------|------|--------|
| DATABASE_URL | PostgreSQL 连接字符串 | postgresql://postgres:postgres@localhost:5432/team_db |
| PORT | 服务端口 | 3000 |
| NODE_ENV | 运行环境 | development |

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
# 注册用户（首次使用会自动创建 API Token）
POST /api/v1/auth/register
Body: { "userId": "your-uuid", "name": "Your Name" }
Response: { "userId": "...", "token": "..." }

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
team-server/
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
