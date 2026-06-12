# ===================================================================
# Multi-stage Dockerfile for Production Deployment
# Optimized for Coolify, Docker Compose, and Kubernetes
# ===================================================================

# ===================================================================
# Stage 1: Dependencies (cached layer)
# ===================================================================
FROM node:20-alpine AS dependencies

# Install production dependencies only
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./

# Install dependencies (use the lockfile that exists)
RUN if [ -f pnpm-lock.yaml ]; then \
      npm install -g pnpm && pnpm install --prod --frozen-lockfile; \
    elif [ -f yarn.lock ]; then \
      yarn install --production --frozen-lockfile; \
    else \
      npm ci --omit=dev; \
    fi

# Add the Prisma CLI to the production node_modules so the runtime image can
# run `npx prisma migrate deploy` at container start (see CMD in stage 3).
# `prisma` is a devDependency (correct for local dev), so the prod-only install
# above does NOT include it — without this step, npx would try to download the
# CLI from the registry on every container boot. Pinned to the exact
# @prisma/client version the lockfile installed, so CLI and client never drift.
# --no-save keeps package.json and the lockfile untouched. Because this stage
# runs on the same Alpine (musl) base as the runtime stage, the engine binaries
# downloaded here are the correct ones for production.
RUN npm install --no-save --no-audit --no-fund \
      "prisma@$(node -p "require('@prisma/client/package.json').version")"

# ===================================================================
# Stage 2: Build (compile TypeScript)
# ===================================================================
FROM node:20-alpine AS builder

# Override NODE_ENV to ensure devDependencies are installed.
# Coolify may inject NODE_ENV=production as a build arg, which causes npm ci
# to skip devDependencies (typescript, @types/node, etc.) and break the build.
ENV NODE_ENV=development

WORKDIR /app

# Copy package files and install ALL dependencies (including dev)
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./

RUN if [ -f pnpm-lock.yaml ]; then \
      npm install -g pnpm && pnpm install --frozen-lockfile; \
    elif [ -f yarn.lock ]; then \
      yarn install --frozen-lockfile; \
    else \
      npm ci; \
    fi

# Copy source code and Prisma schema
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# ===================================================================
# Stage 3: Production Runtime
# ===================================================================
FROM node:20-alpine AS production

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy production dependencies from dependencies stage.
# Includes the Prisma CLI (+ its engines) installed in stage 1, which the
# CMD below needs for `npx prisma migrate deploy`.
COPY --from=dependencies --chown=nodejs:nodejs /app/node_modules ./node_modules

# Copy generated Prisma client from builder stage (not present in prod deps)
COPY --from=builder --chown=nodejs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# Copy built application from builder stage
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./package.json

# Copy Prisma files (needed for migrations)
COPY --from=builder --chown=nodejs:nodejs /app/prisma ./prisma

# Create uploads directory with correct ownership (must be before USER nodejs)
RUN mkdir -p /app/uploads && chown nodejs:nodejs /app/uploads

# Switch to non-root user
USER nodejs

# Expose port (matches default PORT in env.ts; override via PORT env var)
EXPOSE 8000

# Health check for container orchestration.
# start-period is 60s because CMD runs `prisma migrate deploy` BEFORE the server
# starts listening — a slow migration must not be counted as unhealthy, or
# Coolify restart-loops the container mid-migration.
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
  CMD node -e "const p=process.env.PORT||8000;require('http').get('http://localhost:'+p+'/api/v1/live',(r)=>{process.exit(r.statusCode===200?0:1)})"

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the application — apply any pending Prisma migrations first, then boot.
# Runs inside Coolify on every container start, where DATABASE_URL is reachable
# (it isn't from CI, which is why migrations belong here and not in a workflow).
# `migrate deploy` is idempotent: it applies only pending migrations and exits 0
# when there is nothing to do. Requirements, all satisfied above:
#   - prisma CLI in ./node_modules (installed in stage 1, copied with node_modules)
#   - ./prisma/schema.prisma + ./prisma/migrations (copied from builder)
# `exec` replaces the shell so node receives signals from dumb-init directly.
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/server.js"]
