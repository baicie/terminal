# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build the application
RUN npm run build

# Production stage
FROM node:20-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (prisma CLI needed for migrations)
RUN npm ci

# Copy Prisma schema for migrations
COPY prisma ./prisma

# Copy built application
COPY --from=builder /app/dist ./dist

# Generate Prisma client in production
RUN npx prisma generate

# Expose port
EXPOSE 3000

# Environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Start the application (run migrations first)
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main"]
