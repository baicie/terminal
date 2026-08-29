# syntax=docker/dockerfile:1

FROM node:24.16.0-alpine AS base

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
WORKDIR /workspace

# Keep the package manager aligned with the lockfile and local toolchain pin.
RUN npm install --global pnpm@10.34.3

FROM base AS builder

# Copy manifests first so dependency installation remains cacheable.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/team-server/package.json packages/team-server/package.json
COPY packages/team-server/prisma packages/team-server/prisma
COPY packages/team-server/prisma.config.ts packages/team-server/prisma.config.ts
RUN pnpm install --frozen-lockfile --filter=team-server

COPY packages/team-server packages/team-server
RUN pnpm --filter=team-server prisma:generate
RUN pnpm --filter=team-server build

FROM base AS production

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/team-server/package.json packages/team-server/package.json
COPY packages/team-server/prisma packages/team-server/prisma
COPY packages/team-server/prisma.config.ts packages/team-server/prisma.config.ts

# Prisma CLI is a runtime dependency because migrations run on container start.
RUN pnpm install --frozen-lockfile --filter=team-server --prod
RUN pnpm --filter=team-server prisma:generate

COPY --from=builder /workspace/packages/team-server/dist packages/team-server/dist

WORKDIR /workspace/packages/team-server
EXPOSE 3000
USER node

# Fail fast when migrations cannot be applied; do not start a partially upgraded API.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && exec node dist/main.js"]
