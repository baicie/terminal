# Team Server — 自托管部署指南

> **本文档**：适用于希望在自己的服务器上运行团队协作服务的用户。
> 前端 Terminal 应用通过 WebDAV / S3 / 自定义 REST API 与此服务通信，实现跨设备数据同步和团队协作。

---

## 目录

1. [架构概述](#1-架构概述)
2. [快速部署（Docker Compose）](#2-快速部署docker-compose)
3. [生产环境配置](#3-生产环境配置)
4. [反向代理配置](#4-反向代理配置)
5. [数据库维护](#5-数据库维护)
6. [安全加固](#6-安全加固)
7. [故障排查](#7-故障排查)

---

## 1. 架构概述

```
┌─────────────────────────────────────────────────────┐
│                    用户浏览器                         │
│              (Terminal Desktop App)                  │
└──────────────┬────────────────────────────────────┘
               │ HTTPS (REST API / WebDAV)
               ▼
┌─────────────────────────────────────────────────────┐
│               反向代理（Nginx / Caddy）              │
│         TLS 终止 + 证书管理 + 限流                  │
└──────────────┬────────────────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌──────────────┐   ┌──────────────────────────┐
│  Team Server  │   │    PostgreSQL 16         │
│  (NestJS)    │   │    (持久化数据)          │
│  Port 3000   │   │    Port 5432            │
└──────────────┘   └──────────────────────────┘
```

**核心模块**：

| 模块 | 路径 | 功能 |
|------|------|------|
| 认证 | `/api/v1/auth/*` | 注册、API Token 管理 |
| 团队 | `/api/v1/teams/*` | 创建/管理团队 |
| 成员 | `/api/v1/teams/:id/members/*` | 添加/移除成员 |
| 分享 | `/api/v1/teams/:id/shares/*` | 分享主机/代码片段 |
| 邀请 | `/api/v1/teams/:id/invites/*` | 邀请链接/码 |
| 审计 | `/api/v1/teams/:id/audit/*` | 操作日志 |
| 同步 | `/api/v1/sync/*` | 增量数据同步 |
| 健康检查 | `/health`, `/health/live`, `/health/ready` | K8s 就绪/存活探针 |

---

## 2. 快速部署（Docker Compose）

### 前置条件

- Docker 24.0+
- Docker Compose v2.20+
- 域名（可选，用于 HTTPS）

### 步骤

```bash
# 1. 克隆项目
git clone https://github.com/your-org/terminal.git
cd terminal/packages/team-server

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env，修改 DATABASE_URL 密码
vim .env

# 3. 启动服务
docker compose up -d

# 4. 检查健康状态
curl http://localhost:3000/health
# 期望输出：{"status":"ok","db":"connected"}

# 5. 查看日志
docker compose logs -f team-server
```

**初始账号**：首次访问 `/api/v1/auth/register` 注册第一个账号。

---

## 3. 生产环境配置

### 3.1 环境变量（`.env`）

```bash
# 数据库连接（必须修改密码）
DATABASE_URL="postgresql://postgres:<YOUR_PASSWORD>@localhost:5432/team_db"

# 服务端口（不建议修改）
PORT=3000

# 运行环境
NODE_ENV=production
```

### 3.2 数据库初始化

```bash
# 运行数据库迁移
docker compose exec team-server npx prisma migrate deploy

# （可选）填充种子数据
docker compose exec team-server npx prisma db seed
```

### 3.3 Docker Compose 生产配置

建议在 `docker-compose.override.yml` 或独立的 `docker-compose.prod.yml` 中添加资源限制和重启策略：

```yaml
# docker-compose.prod.yml
version: '3.9'

services:
  team-server:
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.5'
        reservations:
          memory: 256M
    environment:
      NODE_ENV: production
      DATABASE_URL: ${DATABASE_URL}
      PORT: 3000

  db:
    restart: unless-stopped
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.25'
    volumes:
      - pgdata:/var/lib/postgresql/data
    # 生产环境建议定期备份，添加定时任务：
    # 0 3 * * * docker compose exec db pg_dump -U postgres team_db > /backup/team_db_$(date +%Y%m%d).sql

volumes:
  pgdata:
```

```bash
# 启动生产配置
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

---

## 4. 反向代理配置

### 4.1 Nginx

```nginx
# /etc/nginx/sites-available/team-server
server {
    listen 443 ssl http2;
    server_name team-api.example.com;

    ssl_certificate     /etc/letsencrypt/live/team-api.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/team-api.example.com/privkey.pem;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # API 限流（防止滥用）
    limit_req_zone $binary_remote_addr zone=api_limit:10m rate=100r/m;
    limit_req zone=api_limit burst=50 nodelay;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 超时配置
        proxy_connect_timeout 30s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;

        # K8s 探针（健康检查不过反向代理）
        location /health {
            proxy_pass http://127.0.0.1:3000/health;
            limit_req off;
        }
    }
}
```

### 4.2 Caddy（推荐，更简单）

```caddy
# Caddyfile
team-api.example.com {
    reverse_proxy localhost:3000

    # 自动 HTTPS
    tls internal

    # 安全头
    header {
        X-Frame-Options "SAMEORIGIN"
        X-Content-Type-Options "nosniff"
        Strict-Transport-Security "max-age=31536000"
    }
}
```

```bash
# 启动 Caddy
caddy run --config Caddyfile
```

---

## 5. 数据库维护

### 5.1 备份

```bash
# 方式 A：pg_dump（推荐）
docker compose exec -T db pg_dump -U postgres team_db > team_db_backup_$(date +%Y%m%d_%H%M%S).sql

# 方式 B：完整 Volume 快照
docker compose stop db
docker run --rm -v $(docker compose ps -q db):/data -v $(pwd):/backup alpine tar czf /backup/pgdata_snapshot.tar.gz -C /data .
docker compose start db
```

### 5.2 恢复

```bash
# 停止服务
docker compose stop team-server

# 恢复数据库
cat team_db_backup.sql | docker compose exec -T db psql -U postgres team_db

# 启动服务
docker compose start team-server
```

### 5.3 迁移升级

```bash
# 拉取最新代码
git pull

# 重新构建镜像
docker compose build team-server

# 运行新迁移
docker compose run --rm team-server npx prisma migrate deploy

# 重启服务
docker compose up -d team-server
```

---

## 6. 安全加固

### 6.1 必做项

| 项目 | 操作 |
|------|------|
| **修改数据库密码** | 在 `.env` 中设置强密码（≥16位，随机生成） |
| **启用 TLS** | 通过反向代理配置 HTTPS（Let's Encrypt 免费证书） |
| **限制数据库访问** | 仅允许 `127.0.0.1` 或 Docker 网络访问，勿暴露 Port 5432 |
| **定期备份** | 设置 cron 任务或使用 pgBackRest |
| **监控日志** | 配置日志收集（ Loki / ELK / CloudWatch） |

### 6.2 可选加固

| 项目 | 说明 |
|------|------|
| **API 限流** | Nginx `limit_req` 或在 NestJS 中配置 `@nestjs/throttler` |
| **WAF** | 如 Cloudflare ModSecurity、Nginx + ModSecurity |
| **入侵检测** | 配置 `fail2ban` 防止暴力破解注册接口 |
| **网络隔离** | 使用 Docker 网络隔离，将数据库置于内部网络 |
| **环境隔离** | 生产环境使用 `.env.production`，勿与开发环境混用 |

### 6.3 API Token 安全

- Token 仅在创建时显示一次，之后无法找回
- 建议为每个设备/客户端生成独立 Token，便于权限管理和撤销
- Token 设置过期时间（可在 `auth.service.ts` 中扩展）

---

## 7. 故障排查

### 服务无法启动

```bash
# 查看详细日志
docker compose logs team-server

# 常见原因：数据库未就绪
# → 确认 db 容器状态
docker compose ps db
# → 检查 DATABASE_URL 是否正确
```

### 健康检查失败

```bash
curl http://localhost:3000/health/live   # 存活探针
curl http://localhost:3000/health/ready  # 就绪探针（含 DB 检查）
```

### 数据库连接失败

```bash
# 进入容器测试连接
docker compose exec team-server sh
nc -zv db 5432   # 检查网络连通性
```

### 502 Bad Gateway

```bash
# team-server 未运行或崩溃
docker compose logs team-server
docker compose restart team-server
```

### 迁移失败

```bash
# 查看当前迁移状态
docker compose exec team-server npx prisma migrate status

# 回滚（谨慎操作）
docker compose exec team-server npx prisma migrate resolve --rolled-back <migration_name>
```

---

## 附录：API 快速参考

### 注册用户

```bash
curl -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"your-password"}'
```

### 创建 API Token

```bash
curl -X POST http://localhost:3000/api/v1/auth/tokens \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -d '{"name":"My Desktop"}'
```

### 创建团队

```bash
curl -X POST http://localhost:3000/api/v1/teams \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -d '{"name":"My Team"}'
```

---

_文档更新时间：2026-05-03_
